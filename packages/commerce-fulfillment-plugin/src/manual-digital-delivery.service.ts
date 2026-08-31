import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    EventBus,
    Logger,
    Order,
    OrderService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
    isGraphQlErrorResult,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { AutoCardCipherService } from './auto-card-cipher.service';
import {
    ManualDigitalDeliveryEvent,
    ManualDigitalDeliveryEventType,
} from './entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { isManualServiceOrderLine } from './fulfillment-classification';
import { ManualDigitalDeliveryReadyEvent } from './manual-digital-delivery.event';
import { manualServiceFulfillmentHandler } from './manual-service-fulfillment-handler';

const MAX_ATTEMPTS = 5;
const MAX_PAGE_SIZE = 100;

export interface ManualDeliveryFieldInput {
    key: string;
    label: string;
    value: string;
    secret?: boolean | null;
}

export interface ManualDeliveryPackageInput {
    fields?: ManualDeliveryFieldInput[] | null;
    note?: string | null;
    attachmentAssetIds?: ID[] | null;
}

export interface SaveManualDeliveryInput {
    id: ID;
    packages: ManualDeliveryPackageInput[];
}

interface StoredManualDeliveryPackage {
    fields: Array<{ key: string; label: string; value: string; secret: boolean }>;
    note: string;
    attachmentAssetIds: string[];
}

@Injectable()
export class ManualDigitalDeliveryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: AutoCardCipherService,
        private readonly eventBus: EventBus,
        private readonly orderService: OrderService,
        private readonly requestContextService: RequestContextService,
    ) {}

    async createSettledOrderTasks(ctx: RequestContext, order: Order): Promise<ManualDigitalDelivery[]> {
        if (order.state !== 'PaymentSettled') {
            return [];
        }
        const recipientEmail = order.customFields?.deliveryEmail?.trim();
        if (!recipientEmail) {
            throw new Error('人工虚拟交付订单缺少交付邮箱');
        }
        const repository = this.connection.getRepository(ctx, ManualDigitalDelivery);
        const deliveries: ManualDigitalDelivery[] = [];
        for (const line of order.lines.filter(isManualServiceOrderLine)) {
            const existing = await repository.findOne({ where: { orderLineId: line.id } });
            if (existing) {
                deliveries.push(existing);
                continue;
            }
            const expectedAt = new Date(
                Date.now() +
                    Math.max(5, line.customFields?.manualDeliverySlaMinutesSnapshot ?? 1440) * 60_000,
            );
            const candidate = new ManualDigitalDelivery({
                state: 'WAITING_PROCESSING',
                recipientEmail,
                languageCode: String(ctx.languageCode),
                productName: line.productVariant.name,
                sku: line.productVariant.sku,
                quantity: line.quantity,
                expectedAt,
                encryptedPackages: null,
                attachmentAssetIdsJson: '[]',
                attemptCount: 0,
                lastError: null,
                lastDispatchedAt: null,
                sentAt: null,
                fulfillmentId: null,
                channelId: ctx.channelId,
                orderId: order.id,
                orderLineId: line.id,
            });
            let delivery: ManualDigitalDelivery;
            try {
                delivery = await repository.save(candidate);
                await this.addEvent(ctx, delivery, 'TASK_CREATED', '付款完成，已创建人工交付任务');
            } catch (error) {
                const concurrent = await repository.findOne({ where: { orderLineId: line.id } });
                if (!concurrent) throw error;
                delivery = concurrent;
            }
            deliveries.push(delivery);
        }
        return deliveries;
    }

    async list(
        ctx: RequestContext,
        options: { skip?: number | null; take?: number | null; state?: string | null } = {},
    ): Promise<{ items: ManualDigitalDelivery[]; totalItems: number }> {
        const skip = Math.max(0, Math.trunc(options.skip ?? 0));
        const take = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(options.take ?? 20)));
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ManualDigitalDelivery)
            .findAndCount({
                where: {
                    channelId: ctx.channelId,
                    ...(options.state ? { state: options.state as ManualDigitalDelivery['state'] } : {}),
                },
                relations: { order: true, events: true },
                order: { expectedAt: 'ASC', createdAt: 'ASC' },
                skip,
                take,
            });
        return { items: items.map(item => this.attachView(item)), totalItems };
    }

    async one(ctx: RequestContext, id: ID): Promise<ManualDigitalDelivery> {
        return this.attachView(await this.ownedDelivery(ctx, id));
    }

    async forOrder(ctx: RequestContext, orderId: ID): Promise<ManualDigitalDelivery[]> {
        const items = await this.connection.getRepository(ctx, ManualDigitalDelivery).find({
            where: { channelId: ctx.channelId, orderId },
            relations: { events: true },
            order: { createdAt: 'ASC' },
        });
        return items.map(item => this.attachView(item));
    }

    async saveDraft(ctx: RequestContext, input: SaveManualDeliveryInput): Promise<ManualDigitalDelivery> {
        const delivery = await this.ownedDelivery(ctx, input.id);
        if (!['WAITING_PROCESSING', 'DRAFT'].includes(delivery.state)) {
            throw new UserInputError('当前人工交付状态不能修改成品内容');
        }
        const packages = await this.normalizePackages(ctx, input.packages);
        delivery.encryptedPackages = this.cipher.encrypt({ payload: JSON.stringify(packages) });
        delivery.attachmentAssetIdsJson = JSON.stringify([
            ...new Set(packages.flatMap(item => item.attachmentAssetIds)),
        ]);
        delivery.state = 'DRAFT';
        delivery.lastError = null;
        const saved = await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
        await this.addEvent(ctx, saved, 'DRAFT_SAVED', '管理员保存了人工交付成品草稿', 'ADMIN');
        return this.attachView(saved);
    }

    async publish(ctx: RequestContext, input: SaveManualDeliveryInput): Promise<ManualDigitalDelivery> {
        const delivery = await this.ownedDelivery(ctx, input.id);
        if (!['WAITING_PROCESSING', 'DRAFT'].includes(delivery.state)) {
            throw new UserInputError('当前状态不能覆盖成品；邮件失败或已发布时只能重发原成品');
        }
        const packages = await this.normalizePackages(ctx, input.packages);
        if (packages.length !== delivery.quantity) {
            throw new UserInputError(
                `订单购买 ${delivery.quantity} 份，必须录入并发布 ${delivery.quantity} 个成品包`,
            );
        }
        delivery.encryptedPackages = this.cipher.encrypt({ payload: JSON.stringify(packages) });
        delivery.attachmentAssetIdsJson = JSON.stringify([
            ...new Set(packages.flatMap(item => item.attachmentAssetIds)),
        ]);
        delivery.state = 'SENDING';
        delivery.lastError = null;
        delivery.lastDispatchedAt = new Date();
        const saved = await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
        await this.addEvent(ctx, saved, 'PUBLISHED', '管理员发布了人工交付成品', 'ADMIN');
        await this.eventBus.publish(new ManualDigitalDeliveryReadyEvent(ctx, String(saved.id)));
        return this.attachView(saved);
    }

    async retry(ctx: RequestContext, id: ID): Promise<ManualDigitalDelivery> {
        const delivery = await this.ownedDelivery(ctx, id);
        if (!delivery.encryptedPackages) {
            throw new UserInputError('尚未保存成品，不能发送');
        }
        if (!['EMAIL_FAILED', 'MANUAL_REVIEW', 'SENT'].includes(delivery.state)) {
            throw new UserInputError('当前状态不能重发');
        }
        delivery.state = 'SENDING';
        delivery.lastError = null;
        delivery.lastDispatchedAt = new Date();
        await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
        await this.addEvent(ctx, delivery, 'MANUAL_RETRY', '管理员重发原成品，内容未变更', 'ADMIN');
        await this.eventBus.publish(new ManualDigitalDeliveryReadyEvent(ctx, String(delivery.id)));
        return this.attachView(delivery);
    }

    async emailPayload(ctx: RequestContext, id: ID) {
        const delivery = await this.ownedDelivery(ctx, id);
        const packages = this.readPackages(delivery);
        if (packages.length !== delivery.quantity) {
            delivery.state = 'MANUAL_REVIEW';
            delivery.lastError = `成品数量异常：订单需要 ${delivery.quantity} 份，实际保存 ${packages.length} 份`;
            await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
            await this.addEvent(ctx, delivery, 'MANUAL_REVIEW', delivery.lastError);
            throw new Error(delivery.lastError);
        }
        const assetIds = [...new Set(packages.flatMap(item => item.attachmentAssetIds))];
        const assets = assetIds.length
            ? await this.connection.getRepository(ctx, Asset).find({ where: { id: In(assetIds) } })
            : [];
        return {
            deliveryId: String(delivery.id),
            recipientEmail: delivery.recipientEmail,
            orderCode: delivery.order.code,
            productName: delivery.productName,
            sku: delivery.sku,
            isChinese: delivery.languageCode === 'zh_Hans',
            packages: packages.map((item, index) => ({ ...item, number: index + 1 })),
            attachments: assets.map(asset => ({
                id: String(asset.id),
                filename: asset.name,
                source: asset.source,
            })),
        };
    }

    async recordEmailResult(ctx: RequestContext, id: ID, success: boolean, error?: Error): Promise<void> {
        const delivery = await this.ownedDelivery(ctx, id);
        if (success && delivery.state === 'SENT') {
            return;
        }
        delivery.attemptCount += 1;
        if (!success) {
            delivery.lastError = String(error?.message ?? '邮件发送失败').slice(0, 2_000);
            delivery.state = delivery.attemptCount >= MAX_ATTEMPTS ? 'MANUAL_REVIEW' : 'EMAIL_FAILED';
            await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
            await this.addEvent(
                ctx,
                delivery,
                delivery.state === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'EMAIL_FAILED',
                delivery.state === 'MANUAL_REVIEW'
                    ? '邮件多次发送失败，已转人工核查'
                    : '人工交付邮件发送失败，将重试原成品',
            );
            return;
        }
        delivery.state = 'SENT';
        delivery.sentAt = new Date();
        delivery.lastError = null;
        await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
        await this.addEvent(ctx, delivery, 'EMAIL_SENT', '人工交付邮件已发送');
        await this.completeFulfillment(ctx, delivery);
    }

    async cancelOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const repository = this.connection.getRepository(ctx, ManualDigitalDelivery);
        const deliveries = await repository.find({ where: { channelId: ctx.channelId, orderId } });
        for (const delivery of deliveries.filter(item => !['SENT', 'CANCELLED'].includes(item.state))) {
            delivery.state = 'CANCELLED';
            await repository.save(delivery);
            await this.addEvent(ctx, delivery, 'CANCELLED', '订单取消，人工交付任务已关闭');
        }
    }

    async reconcilePending(): Promise<{ redispatched: number; completedFulfillments: number }> {
        const deliveries = await this.connection.rawConnection.getRepository(ManualDigitalDelivery).find({
            where: [{ state: In(['SENDING', 'EMAIL_FAILED']) }, { state: 'SENT', fulfillmentId: IsNull() }],
            relations: { channel: true, order: true, orderLine: true },
            order: { createdAt: 'ASC' },
            take: 200,
        });
        let redispatched = 0;
        let completedFulfillments = 0;
        for (const delivery of deliveries) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: delivery.channel,
            });
            try {
                if (delivery.state === 'SENT' && !delivery.fulfillmentId) {
                    await this.completeFulfillment(ctx, delivery);
                    completedFulfillments++;
                    continue;
                }
                if (delivery.attemptCount >= MAX_ATTEMPTS) {
                    continue;
                }
                const age = delivery.lastDispatchedAt
                    ? Date.now() - delivery.lastDispatchedAt.getTime()
                    : Number.POSITIVE_INFINITY;
                const retryAfter = delivery.state === 'SENDING' ? 15 * 60_000 : 5 * 60_000;
                if (age < retryAfter) {
                    continue;
                }
                delivery.state = 'SENDING';
                delivery.lastError = null;
                delivery.lastDispatchedAt = new Date();
                await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
                await this.addEvent(ctx, delivery, 'AUTO_RETRY', '系统重试发送原成品');
                await this.eventBus.publish(new ManualDigitalDeliveryReadyEvent(ctx, String(delivery.id)));
                redispatched++;
            } catch (error) {
                Logger.error(error instanceof Error ? error.message : String(error), 'ManualDigitalDelivery');
            }
        }
        return { redispatched, completedFulfillments };
    }

    private async completeFulfillment(ctx: RequestContext, delivery: ManualDigitalDelivery): Promise<void> {
        if (delivery.fulfillmentId) {
            return;
        }
        const result = await this.orderService.createFulfillment(ctx, {
            lines: [{ orderLineId: delivery.orderLineId, quantity: delivery.quantity }],
            handler: { code: manualServiceFulfillmentHandler.code, arguments: [] },
        });
        if (isGraphQlErrorResult(result)) {
            throw new Error(result.message);
        }
        const transitioned = await this.orderService.transitionFulfillmentToState(
            ctx,
            result.id,
            'Delivered',
        );
        if (isGraphQlErrorResult(transitioned)) {
            throw new Error(transitioned.message);
        }
        delivery.fulfillmentId = String(result.id);
        await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
    }

    private async normalizePackages(
        ctx: RequestContext,
        input: ManualDeliveryPackageInput[],
    ): Promise<StoredManualDeliveryPackage[]> {
        if (!Array.isArray(input) || input.length > 500) {
            throw new UserInputError('成品包数量无效');
        }
        const packages = input.map((item, packageIndex) => {
            const fields = (item.fields ?? []).map((field, fieldIndex) => {
                const key = field.key?.trim();
                const label = field.label?.trim();
                const value = field.value?.trim();
                if (!key || !label || !value) {
                    throw new UserInputError(
                        `第 ${packageIndex + 1} 个成品包的第 ${fieldIndex + 1} 个字段不完整`,
                    );
                }
                if (key.length > 40 || label.length > 80 || value.length > 10_000) {
                    throw new UserInputError('成品字段超出长度限制');
                }
                return { key, label, value, secret: Boolean(field.secret) };
            });
            const note = item.note?.trim() ?? '';
            if (!fields.length && !note && !(item.attachmentAssetIds?.length ?? 0)) {
                throw new UserInputError(`第 ${packageIndex + 1} 个成品包不能为空`);
            }
            if (note.length > 20_000) {
                throw new UserInputError('成品说明不能超过 20000 个字符');
            }
            return {
                fields,
                note,
                attachmentAssetIds: [...new Set((item.attachmentAssetIds ?? []).map(String))],
            };
        });
        const assetIds = [...new Set(packages.flatMap(item => item.attachmentAssetIds))];
        if (assetIds.length) {
            const count = await this.connection
                .getRepository(ctx, Asset)
                .count({ where: { id: In(assetIds) } });
            if (count !== assetIds.length) {
                throw new UserInputError('部分附件不存在或已删除');
            }
        }
        return packages;
    }

    private readPackages(delivery: ManualDigitalDelivery): StoredManualDeliveryPackage[] {
        if (!delivery.encryptedPackages) {
            return [];
        }
        const raw = this.cipher.decrypt(delivery.encryptedPackages).payload;
        try {
            return JSON.parse(raw ?? '[]') as StoredManualDeliveryPackage[];
        } catch {
            throw new Error('人工交付成品数据损坏，已阻止发送');
        }
    }

    private attachView(delivery: ManualDigitalDelivery): ManualDigitalDelivery {
        if (delivery.events) {
            delivery.events.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        }
        return Object.assign(delivery, {
            packages: this.readPackages(delivery),
            overdue:
                !['SENT', 'CANCELLED'].includes(delivery.state) && delivery.expectedAt.getTime() < Date.now(),
        });
    }

    private async ownedDelivery(ctx: RequestContext, id: ID): Promise<ManualDigitalDelivery> {
        const delivery = await this.connection.getRepository(ctx, ManualDigitalDelivery).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { order: true, orderLine: true, events: true },
        });
        if (!delivery) {
            throw new UserInputError('人工交付任务不存在');
        }
        return delivery;
    }

    private async addEvent(
        ctx: RequestContext,
        delivery: ManualDigitalDelivery,
        type: ManualDigitalDeliveryEventType,
        note: string,
        actorType: 'SYSTEM' | 'ADMIN' = 'SYSTEM',
    ): Promise<ManualDigitalDeliveryEvent> {
        return this.connection.getRepository(ctx, ManualDigitalDeliveryEvent).save(
            new ManualDigitalDeliveryEvent({
                deliveryId: delivery.id,
                type,
                actorType,
                actorId: actorType === 'ADMIN' && ctx.activeUserId ? String(ctx.activeUserId) : null,
                note: note.slice(0, 2_000),
            }),
        );
    }
}
