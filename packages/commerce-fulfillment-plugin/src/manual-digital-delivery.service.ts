import { Injectable } from '@nestjs/common';
import { isConfirmedControlledTestPayment } from '@vendure/common/lib/controlled-test-payment';
import { ID } from '@vendure/common/lib/shared-types';
import {
    assertOrderSalesChannel,
    EventBus,
    FulfillmentLine,
    isGraphQlErrorResult,
    Logger,
    Order,
    OrderService,
    Payment,
    Permission,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { GovernanceService } from '@vendure/store-management-plugin';
import { randomUUID } from 'node:crypto';
import { In, IsNull, LessThanOrEqual } from 'typeorm';

import { AutoCardCipherService } from './auto-card-cipher.service';
import { readSoldAutoCardsPermission } from './auto-card.constants';
import { digitalDeliverableQuantity } from './digital-order-entitlement';
import { DigitalProductService } from './digital-product.service';
import { DigitalFileVersion, DigitalReceiptAccess } from './entities/digital-product.entity';
import {
    ManualDigitalDeliveryEvent,
    ManualDigitalDeliveryEventType,
} from './entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { isManualServiceOrderLine } from './fulfillment-classification';
import { ManualDigitalDeliveryReadyEvent } from './manual-digital-delivery.event';
import { manualServiceFulfillmentHandler } from './manual-service-fulfillment-handler';
import { OrderConfirmationTokenService } from './order-confirmation-token.service';
import { orderLineProductName } from './order-line-snapshot';
import { OrderProcessingChangedEvent } from './order-processing-changed.event';

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
    attachmentFileVersionIds?: ID[] | null;
}

export interface SaveManualDeliveryInput {
    id: ID;
    packages: ManualDeliveryPackageInput[];
}

interface StoredManualDeliveryPackage {
    fields: Array<{ key: string; label: string; value: string; secret: boolean }>;
    note: string;
    attachmentAssetIds: string[];
    attachmentFileVersionIds?: string[];
}

@Injectable()
export class ManualDigitalDeliveryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: AutoCardCipherService,
        private readonly eventBus: EventBus,
        private readonly orderService: OrderService,
        private readonly requestContextService: RequestContextService,
        private readonly digitalProducts: DigitalProductService,
        private readonly receiptTokens: OrderConfirmationTokenService,
        private readonly audit: GovernanceService,
    ) {}

    async createSettledOrderTasks(ctx: RequestContext, order: Order): Promise<ManualDigitalDelivery[]> {
        if (
            !['PaymentSettled', 'PartiallyDelivered', 'Delivered', 'PartiallyShipped'].includes(order.state)
        ) {
            return [];
        }
        const manualServiceLines = order.lines.filter(isManualServiceOrderLine);
        if (manualServiceLines.length === 0) {
            return [];
        }
        assertOrderSalesChannel(ctx, order);
        const recipientEmail = order.customFields?.deliveryEmail?.trim();
        if (!recipientEmail) {
            throw new Error('人工虚拟交付订单缺少交付邮箱');
        }
        const repository = this.connection.getRepository(ctx, ManualDigitalDelivery);
        const deliveries: ManualDigitalDelivery[] = [];
        for (const line of manualServiceLines) {
            const existing = await repository.findOne({
                where: { orderLineId: line.id },
                relations: { order: true },
            });
            if (existing) {
                this.assertDeliveryScope(ctx, existing);
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
                productName: orderLineProductName(ctx, line),
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
                const concurrent = await repository.findOne({
                    where: { orderLineId: line.id },
                    relations: { order: true },
                });
                if (!concurrent) throw error;
                this.assertDeliveryScope(ctx, concurrent);
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
                    order: { salesChannelId: ctx.channelId },
                    ...(options.state ? { state: options.state as ManualDigitalDelivery['state'] } : {}),
                },
                relations: {
                    order: { payments: { refunds: { lines: true } } },
                    orderLine: true,
                    events: true,
                },
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
            where: { channelId: ctx.channelId, orderId, order: { salesChannelId: ctx.channelId } },
            relations: { order: { payments: { refunds: { lines: true } } }, orderLine: true, events: true },
            order: { createdAt: 'ASC' },
        });
        return items.map(item => this.attachView(item));
    }

    async reveal(ctx: RequestContext, id: ID): Promise<ManualDigitalDelivery> {
        if (
            ctx.apiType !== 'admin' ||
            !ctx.activeUserId ||
            !ctx.userHasPermissions([readSoldAutoCardsPermission.Permission, Permission.SuperAdmin])
        )
            throw new UserInputError('需要本单交付内容查看专用权限');
        const delivery = await this.ownedDelivery(ctx, id);
        await this.audit.appendAudit(ctx, {
            eventType: 'MANUAL_DIGITAL_CONTENT_REVEALED',
            resourceType: 'ManualDigitalDelivery',
            resourceId: String(delivery.id),
            actorType: 'ADMIN',
            actorUserId: String(ctx.activeUserId),
            actorLabel: String(ctx.activeUserId),
            reason: '显式查看本店订单已保存交付内容',
            payload: { orderId: String(delivery.orderId), quantity: delivery.quantity },
            idempotencyKey: randomUUID(),
        });
        await this.addEvent(ctx, delivery, 'CONTENT_VIEWED', '管理员显式查看已有交付内容', 'ADMIN');
        return Object.assign(this.attachView(delivery), { packages: this.readPackages(delivery) });
    }

    /** Server-only adjudication. The host must verify content, runtime and all other protected risks. */
    async closeHistoricalTestTask(
        ctx: RequestContext,
        id: ID,
        receiptId: string,
    ): Promise<ManualDigitalDelivery> {
        if (
            ctx.apiType !== 'admin' ||
            !ctx.activeUserId ||
            !ctx.userHasPermissions([Permission.SuperAdmin]) ||
            !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/u.test(receiptId)
        )
            throw new UserInputError('历史测试任务关闭需要受管管理员及有效收据');
        return this.withLockedDelivery(ctx, id, async (txCtx, delivery) => {
            const order = delivery.order;
            if (
                order.active !== false ||
                !['PaymentSettled', 'Modifying'].includes(order.state) ||
                String(delivery.orderLine?.order?.id) !== String(order.id) ||
                delivery.orderLine.customFields?.fulfillmentTypeSnapshot !== 'digital' ||
                delivery.orderLine.customFields?.digitalDeliveryModeSnapshot !== 'manual_service' ||
                !delivery.encryptedPackages ||
                !delivery.events?.some(event => event.type === 'PUBLISHED') ||
                !Array.isArray(order.payments) ||
                !order.payments.some(payment => payment.state === 'Settled') ||
                order.payments.some(
                    payment =>
                        !isConfirmedControlledTestPayment(payment) ||
                        payment.method !== `controlled-test-payment-${order.salesChannelId}` ||
                        !['Authorized', 'Settled'].includes(payment.state) ||
                        payment.metadata?.manualReview?.required ||
                        !Array.isArray(payment.refunds) ||
                        payment.refunds.length !== 0,
                )
            )
                throw new UserInputError('历史测试任务的商品、归属或付款证据不满足关闭条件');
            const [claimed, fulfilled] = await Promise.all([
                this.connection.getRepository(txCtx, DigitalReceiptAccess).count({
                    where: [{ orderId: order.id }, { orderLineId: delivery.orderLineId }],
                }),
                this.connection.getRepository(txCtx, FulfillmentLine).count({
                    where: [
                        { orderLine: { order: { id: order.id } } },
                        { orderLineId: delivery.orderLineId },
                    ],
                }),
            ]);
            if (
                claimed ||
                fulfilled ||
                order.fulfillments?.length ||
                delivery.sentAt ||
                delivery.fulfillmentId ||
                delivery.events.some(event => event.type === 'EMAIL_SENT') ||
                delivery.events.some(event => event.note?.startsWith('[historical-test-late:'))
            )
                throw new UserInputError('已有领取、履约或邮件结果证据，历史测试任务需继续核对');
            const note = `历史测试任务终止；收据 ${receiptId}`;
            if (delivery.state === 'CANCELLED') {
                if (
                    delivery.events.some(
                        event =>
                            event.type === 'CANCELLED' && event.actorType === 'ADMIN' && event.note === note,
                    )
                )
                    return this.attachView(delivery);
                throw new UserInputError('任务已由其他流程关闭，不能替换原关闭依据');
            }
            if (!['SENDING', 'EMAIL_FAILED', 'MANUAL_REVIEW'].includes(delivery.state))
                throw new UserInputError('历史测试任务尚未发布或已经终结');
            delivery.state = 'CANCELLED';
            await this.connection.getRepository(txCtx, ManualDigitalDelivery).save(delivery);
            await this.addEvent(txCtx, delivery, 'CANCELLED', note, 'ADMIN');
            // The reviewed host closes incidents natively in this transaction, with a truthful reason.
            // Sending an ordinary INCIDENT_RESOLVED here would falsely claim email recovery.
            return this.attachView(delivery);
        });
    }

    async saveDraft(
        requestCtx: RequestContext,
        input: SaveManualDeliveryInput,
    ): Promise<ManualDigitalDelivery> {
        return this.withLockedDelivery(requestCtx, input.id, async (ctx, delivery) => {
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
        });
    }

    async publish(
        requestCtx: RequestContext,
        input: SaveManualDeliveryInput,
    ): Promise<ManualDigitalDelivery> {
        return this.withLockedDelivery(requestCtx, input.id, async (ctx, delivery) => {
            this.assertOrderCanDeliver(delivery);
            if (!['WAITING_PROCESSING', 'DRAFT'].includes(delivery.state)) {
                throw new UserInputError('当前状态不能覆盖成品；邮件失败或已发布时只能重发原成品');
            }
            const packages = await this.normalizePackages(ctx, input.packages);
            const eligible = digitalDeliverableQuantity(delivery.order, delivery.orderLine);
            if (packages.length !== eligible)
                throw new UserInputError(`当前需交付 ${eligible} 份，请录入 ${eligible} 个成品`);
            delivery.quantity = packages.length;
            delivery.encryptedPackages = this.cipher.encrypt({ payload: JSON.stringify(packages) });
            delivery.attachmentAssetIdsJson = JSON.stringify([
                ...new Set(packages.flatMap(item => item.attachmentAssetIds)),
            ]);
            delivery.state = 'SENDING';
            delivery.lastError = null;
            delivery.lastDispatchedAt = new Date();
            const saved = await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
            await this.addEvent(ctx, saved, 'PUBLISHED', '管理员发布了人工交付成品', 'ADMIN');
            await this.digitalProducts.consumeLine(
                ctx,
                saved.orderLineId,
                digitalDeliverableQuantity(saved.order, saved.orderLine),
            );
            await this.completeFulfillment(ctx, saved);
            await this.resolveOverdue(ctx, saved);
            await this.eventBus.publish(new ManualDigitalDeliveryReadyEvent(ctx, String(saved.id)));
            return this.attachView(saved);
        });
    }

    async append(requestCtx: RequestContext, input: SaveManualDeliveryInput): Promise<ManualDigitalDelivery> {
        return this.withLockedDelivery(requestCtx, input.id, async (ctx, delivery) => {
            this.assertOrderCanDeliver(delivery);
            if (
                !['SENT', 'EMAIL_FAILED', 'MANUAL_REVIEW'].includes(delivery.state) ||
                !delivery.encryptedPackages
            )
                throw new UserInputError('请先发布原交付内容');
            const existing = this.readPackages(delivery);
            const missing = Math.max(
                0,
                digitalDeliverableQuantity(delivery.order, delivery.orderLine) - existing.length,
            );
            const extra = await this.normalizePackages(ctx, input.packages);
            if (!missing || extra.length !== missing)
                throw new UserInputError(`当前待补交 ${missing} 份，请只填写新增成品`);
            delivery.encryptedPackages = this.cipher.encrypt({
                payload: JSON.stringify([...existing, ...extra]),
            });
            delivery.quantity = existing.length + extra.length;
            delivery.state = 'SENDING';
            delivery.lastError = null;
            delivery.lastDispatchedAt = new Date();
            await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
            await this.digitalProducts.consumeLine(ctx, delivery.orderLineId, extra.length);
            await this.completeFulfillment(ctx, delivery);
            await this.addEvent(
                ctx,
                delivery,
                'PUBLISHED',
                `管理员补交 ${extra.length} 份，原内容保留`,
                'ADMIN',
            );
            await this.eventBus.publish(new ManualDigitalDeliveryReadyEvent(ctx, String(delivery.id)));
            return this.attachView(delivery);
        });
    }

    async retry(requestCtx: RequestContext, id: ID): Promise<ManualDigitalDelivery> {
        return this.withLockedDelivery(requestCtx, id, async (ctx, delivery) => {
            this.assertOrderCanDeliver(delivery);
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
        });
    }

    async notificationPayload(ctx: RequestContext, id: ID) {
        const delivery = await this.ownedDelivery(ctx, id);
        if (!digitalDeliverableQuantity(delivery.order, delivery.orderLine))
            throw new UserInputError('当前领取资格已暂停或撤销');
        const proof = this.receiptTokens.createForDigitalReceipt(ctx, delivery.order);
        return {
            deliveryId: String(delivery.id),
            orderId: String(delivery.orderId),
            recipientEmail: delivery.order.customFields?.deliveryEmail?.trim() || delivery.recipientEmail,
            orderCode: delivery.order.code,
            productName: delivery.productName,
            sku: delivery.sku,
            isChinese: delivery.languageCode === 'zh_Hans',
            receiptPath: `/order-confirmation?id=${encodeURIComponent(delivery.order.code)}&token=${encodeURIComponent(proof.token)}`,
        };
    }

    async emailPayload(ctx: RequestContext, id: ID) {
        const delivery = await this.ownedDelivery(ctx, id);
        this.assertOrderCanDeliver(delivery);
        const packages = this.readPackages(delivery);
        if (packages.length !== delivery.quantity) {
            delivery.state = 'MANUAL_REVIEW';
            delivery.lastError = `成品数量异常：订单需要 ${delivery.quantity} 份，实际保存 ${packages.length} 份`;
            await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
            await this.addEvent(ctx, delivery, 'MANUAL_REVIEW', delivery.lastError);
            await this.publishDeliveryFailure(ctx, delivery, delivery.lastError);
            throw new Error(delivery.lastError);
        }

        return {
            deliveryId: String(delivery.id),
            recipientEmail: delivery.order.customFields?.deliveryEmail?.trim() || delivery.recipientEmail,
            orderCode: delivery.order.code,
            productName: delivery.productName,
            sku: delivery.sku,
            isChinese: delivery.languageCode === 'zh_Hans',
            packages: packages
                .slice(0, digitalDeliverableQuantity(delivery.order, delivery.orderLine))
                .map((item, index) => ({ ...item, number: index + 1 })),
            attachments: [],
        };
    }

    async queuedEmailPayload(ctx: RequestContext, id: ID) {
        const delivery = await this.ownedDelivery(ctx, id);
        if (
            !['SENDING', 'EMAIL_FAILED'].includes(delivery.state) ||
            delivery.order.state === 'Cancelled' ||
            delivery.orderLine.quantity === 0
        ) {
            throw new UserInputError('人工交付任务已关闭或当前状态不能发送邮件');
        }
        return this.notificationPayload(ctx, id);
    }

    async recordEmailResult(
        requestCtx: RequestContext,
        id: ID,
        success: boolean,
        error?: Error,
    ): Promise<void> {
        return this.withLockedDelivery(requestCtx, id, async (ctx, delivery) => {
            if (
                delivery.state === 'CANCELLED' &&
                delivery.events?.some(
                    event =>
                        event.type === 'CANCELLED' &&
                        event.actorType === 'ADMIN' &&
                        event.note.startsWith('历史测试任务终止；收据 '),
                )
            ) {
                const outcome = success ? 'success' : 'failure';
                const type = success ? 'EMAIL_SENT' : 'EMAIL_FAILED';
                const attempt = delivery.lastDispatchedAt?.toISOString() ?? 'unknown';
                const note = `[historical-test-late:${attempt}:${outcome}] 历史测试任务关闭后的迟到邮件${success ? '成功' : '失败'}回执；仅留证，不重开任务`;
                if (!delivery.events.some(event => event.type === type && event.note === note))
                    await this.addEvent(ctx, delivery, type, note);
                return;
            }
            const hadManualReview =
                delivery.state === 'MANUAL_REVIEW' ||
                delivery.events?.some(event => event.type === 'MANUAL_REVIEW') === true;
            // Old queued attempts must not reopen a cancelled or already completed task.
            if (delivery.state === 'CANCELLED' || delivery.state === 'SENT') {
                return;
            }
            // A queued attempt rejected after the task reached manual review must not replace
            // the original send error with a secondary "current state cannot send" error.
            if (delivery.state === 'MANUAL_REVIEW' && !success) {
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
                if (delivery.state === 'MANUAL_REVIEW') {
                    await this.publishDeliveryFailure(ctx, delivery, delivery.lastError);
                }
                return;
            }
            delivery.state = 'SENT';
            delivery.sentAt = new Date();
            delivery.lastError = null;
            await this.connection.getRepository(ctx, ManualDigitalDelivery).save(delivery);
            await this.addEvent(ctx, delivery, 'EMAIL_SENT', '人工交付邮件已发送');
            if (hadManualReview) await this.resolveDeliveryFailure(ctx, delivery);
            await this.resolveOverdue(ctx, delivery);
            await this.completeFulfillment(ctx, delivery);
        });
    }

    async cancelOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const deliveries = await this.connection.getRepository(ctx, ManualDigitalDelivery).find({
            where: { channelId: ctx.channelId, orderId, order: { salesChannelId: ctx.channelId } },
            order: { id: 'ASC' },
        });
        for (const candidate of deliveries) {
            await this.withLockedDelivery(ctx, candidate.id, async (txCtx, delivery) => {
                if (String(delivery.orderId) !== String(orderId))
                    throw new UserInputError('人工交付任务的订单归属已变化，请核对后重试');
                if (['SENT', 'CANCELLED'].includes(delivery.state)) return;
                delivery.state = 'CANCELLED';
                await this.connection.getRepository(txCtx, ManualDigitalDelivery).save(delivery);
                await this.addEvent(txCtx, delivery, 'CANCELLED', '订单取消，人工交付任务已关闭');
                await this.resolveOverdue(txCtx, delivery);
            });
        }
    }

    async reconcilePending(): Promise<{ redispatched: number; completedFulfillments: number }> {
        const deliveries = await this.connection.rawConnection.getRepository(ManualDigitalDelivery).find({
            where: [
                { state: In(['SENDING', 'EMAIL_FAILED']) },
                { state: 'SENT', fulfillmentId: IsNull() },
                { state: In(['WAITING_PROCESSING', 'DRAFT']), expectedAt: LessThanOrEqual(new Date()) },
            ],
            relations: { channel: true },
            order: { createdAt: 'ASC' },
            take: 200,
        });
        let redispatched = 0;
        let completedFulfillments = 0;
        for (const candidate of deliveries) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: candidate.channel,
            });
            try {
                await this.withLockedDelivery(ctx, candidate.id, async (txCtx, delivery) => {
                    if (['WAITING_PROCESSING', 'DRAFT'].includes(delivery.state)) {
                        if (delivery.expectedAt <= new Date()) await this.publishOverdue(txCtx, delivery);
                        return;
                    }
                    if (delivery.state === 'SENT' && !delivery.fulfillmentId) {
                        await this.completeFulfillment(txCtx, delivery);
                        if (delivery.fulfillmentId) completedFulfillments++;
                        return;
                    }
                    if (
                        !['SENDING', 'EMAIL_FAILED'].includes(delivery.state) ||
                        delivery.attemptCount >= MAX_ATTEMPTS ||
                        !digitalDeliverableQuantity(delivery.order, delivery.orderLine)
                    )
                        return;
                    const age = delivery.lastDispatchedAt
                        ? Date.now() - delivery.lastDispatchedAt.getTime()
                        : Number.POSITIVE_INFINITY;
                    const retryAfter = delivery.state === 'SENDING' ? 15 * 60_000 : 5 * 60_000;
                    if (age < retryAfter) return;
                    delivery.state = 'SENDING';
                    delivery.lastError = null;
                    delivery.lastDispatchedAt = new Date();
                    await this.connection.getRepository(txCtx, ManualDigitalDelivery).save(delivery);
                    await this.addEvent(txCtx, delivery, 'AUTO_RETRY', '系统重试发送原成品');
                    await this.eventBus.publish(
                        new ManualDigitalDeliveryReadyEvent(txCtx, String(delivery.id)),
                    );
                    redispatched++;
                });
            } catch (error) {
                Logger.error(error instanceof Error ? error.message : String(error), 'ManualDigitalDelivery');
            }
        }
        return { redispatched, completedFulfillments };
    }

    private async completeFulfillment(ctx: RequestContext, delivery: ManualDigitalDelivery): Promise<void> {
        this.assertDeliveryScope(ctx, delivery);
        const fulfillmentLines = await this.connection
            .getRepository(ctx, FulfillmentLine)
            .find({ where: { orderLineId: delivery.orderLineId }, relations: ['fulfillment'] });
        const fulfilled = fulfillmentLines
            .filter(item => item.fulfillment.state !== 'Cancelled')
            .reduce((sum, item) => sum + item.quantity, 0);
        const quantity = Math.max(
            0,
            Math.min(delivery.quantity, digitalDeliverableQuantity(delivery.order, delivery.orderLine)) -
                fulfilled,
        );
        if (!quantity) return;
        const result = await this.orderService.createFulfillment(ctx, {
            lines: [{ orderLineId: delivery.orderLineId, quantity }],
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
            if (item.attachmentAssetIds?.length)
                throw new UserInputError('交付附件必须上传到私有交付文件，不能使用公开商品素材');
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
            if (!fields.length && !note && !(item.attachmentFileVersionIds?.length ?? 0)) {
                throw new UserInputError(`第 ${packageIndex + 1} 个成品包不能为空`);
            }
            if (note.length > 20_000) {
                throw new UserInputError('成品说明不能超过 20000 个字符');
            }
            return {
                fields,
                note,
                attachmentAssetIds: [],
                attachmentFileVersionIds: [...new Set((item.attachmentFileVersionIds ?? []).map(String))],
            };
        });
        const ids = [...new Set(packages.flatMap(item => item.attachmentFileVersionIds ?? []))];
        if (
            ids.length &&
            (await this.connection
                .getRepository(ctx, DigitalFileVersion)
                .count({ where: { id: In(ids), channelId: ctx.channelId } })) !== ids.length
        )
            throw new UserInputError('部分私有附件不存在或不属于当前店铺');
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
            recipientEmail: delivery.order.customFields?.deliveryEmail?.trim() || delivery.recipientEmail,
            packages: [],
            hasContent: Boolean(delivery.encryptedPackages),
            eligibleQuantity: digitalDeliverableQuantity(delivery.order, delivery.orderLine),
            overdue:
                !['SENT', 'CANCELLED'].includes(delivery.state) && delivery.expectedAt.getTime() < Date.now(),
        });
    }

    private async withLockedDelivery<T>(
        ctx: RequestContext,
        id: ID,
        operation: (txCtx: RequestContext, delivery: ManualDigitalDelivery) => Promise<T>,
    ): Promise<T> {
        return this.orderService.withOrderMutationTransaction(ctx, async txCtx => {
            const observed = await this.ownedDelivery(txCtx, id);
            // The registered native cart hook runs before Order. The managed host must register it too.
            await this.orderService.lockOrderForRefund(txCtx, observed.orderId);
            const payments = await this.connection.getRepository(txCtx, Payment).find({
                where: { order: { id: observed.orderId } },
                order: { id: 'ASC' },
            });
            for (const payment of payments) await this.digitalProducts.lock(txCtx, Payment, payment.id);
            await this.digitalProducts.lock(txCtx, ManualDigitalDelivery, id);
            const delivery = await this.ownedDelivery(txCtx, id);
            if (String(delivery.orderId) !== String(observed.orderId))
                throw new UserInputError('人工交付任务的订单归属已变化，请核对后重试');
            return operation(txCtx, delivery);
        });
    }

    private async ownedDelivery(ctx: RequestContext, id: ID): Promise<ManualDigitalDelivery> {
        const delivery = await this.connection.getRepository(ctx, ManualDigitalDelivery).findOne({
            where: { id, channelId: ctx.channelId },
            relations: {
                order: { payments: { refunds: { lines: true } }, fulfillments: true },
                orderLine: { order: true, productVariant: true },
                events: true,
            },
        });
        if (!delivery) {
            throw new UserInputError('人工交付任务不存在');
        }
        this.assertDeliveryScope(ctx, delivery);
        return delivery;
    }

    private assertDeliveryScope(ctx: RequestContext, delivery: ManualDigitalDelivery): void {
        if (
            !delivery.order ||
            String(delivery.order.id) !== String(delivery.orderId) ||
            String(delivery.channelId) !== String(ctx.channelId)
        ) {
            throw new UserInputError('人工交付任务归属不一致，请核查');
        }
        assertOrderSalesChannel(ctx, delivery.order);
    }

    private assertOrderCanDeliver(delivery: ManualDigitalDelivery): void {
        if (
            !['PaymentSettled', 'PartiallyShipped', 'Shipped', 'PartiallyDelivered', 'Delivered'].includes(
                delivery.order.state,
            ) ||
            delivery.orderLine.quantity <= 0
        ) {
            throw new UserInputError('订单已取消或尚未完成付款，不能发送人工交付');
        }
        if (!digitalDeliverableQuantity(delivery.order, delivery.orderLine)) {
            throw new UserInputError('该订单商品尚未付款、已取消或正在退款，不能继续交付');
        }
    }

    private async addEvent(
        ctx: RequestContext,
        delivery: ManualDigitalDelivery,
        type: ManualDigitalDeliveryEventType,
        note: string,
        actorType: 'SYSTEM' | 'ADMIN' = 'SYSTEM',
    ): Promise<ManualDigitalDeliveryEvent> {
        const saved = await this.connection.getRepository(ctx, ManualDigitalDeliveryEvent).save(
            new ManualDigitalDeliveryEvent({
                deliveryId: delivery.id,
                type,
                actorType,
                actorId: actorType === 'ADMIN' && ctx.activeUserId ? String(ctx.activeUserId) : null,
                note: note.slice(0, 2_000),
            }),
        );
        await this.eventBus.publish(new OrderProcessingChangedEvent(ctx, String(delivery.orderId)));
        return saved;
    }

    private publishDeliveryFailure(
        ctx: RequestContext,
        delivery: ManualDigitalDelivery,
        reason: string,
    ): Promise<void> {
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_FIRING',
                eventType: 'commerce.fulfillment.manual_delivery_failed',
                category: 'FULFILLMENT',
                severity: 'P1',
                sourceType: 'ManualDigitalDelivery',
                sourceId: String(delivery.id),
                fingerprint: `commerce.fulfillment.manual_delivery_failed:${delivery.id}`,
                title: `人工交付发送失败 · 订单 ${delivery.order?.code ?? delivery.orderId}`,
                payload: {
                    channelId: String(delivery.channelId),
                    deliveryId: String(delivery.id),
                    orderId: String(delivery.orderId),
                    orderCode: delivery.order?.code ?? null,
                    sku: delivery.sku,
                    quantity: delivery.quantity,
                    attemptCount: delivery.attemptCount,
                    reason: safeOperationalError(reason),
                    adminPath: `/sales/orders/${delivery.orderId}`,
                },
            }),
        );
    }

    private resolveDeliveryFailure(ctx: RequestContext, delivery: ManualDigitalDelivery): Promise<void> {
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_RESOLVED',
                eventType: 'commerce.fulfillment.manual_delivery_failed',
                category: 'FULFILLMENT',
                severity: 'P2',
                fingerprint: `commerce.fulfillment.manual_delivery_failed:${delivery.id}`,
                title: '人工交付发送已恢复',
                payload: { deliveryId: String(delivery.id), state: delivery.state },
            }),
        );
    }

    private publishOverdue(ctx: RequestContext, delivery: ManualDigitalDelivery): Promise<void> {
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_FIRING',
                eventType: 'commerce.fulfillment.manual_delivery_overdue',
                category: 'FULFILLMENT',
                severity: 'P1',
                sourceType: 'ManualDigitalDelivery',
                sourceId: String(delivery.id),
                fingerprint: `commerce.fulfillment.manual_delivery_overdue:${delivery.id}`,
                title: `人工交付已超过承诺时间 · 订单 ${delivery.order?.code ?? delivery.orderId}`,
                payload: {
                    channelId: String(delivery.channelId),
                    deliveryId: String(delivery.id),
                    orderId: String(delivery.orderId),
                    orderCode: delivery.order?.code ?? null,
                    sku: delivery.sku,
                    expectedAt: delivery.expectedAt.toISOString(),
                    adminPath: `/sales/orders/${delivery.orderId}`,
                },
            }),
        );
    }

    private resolveOverdue(ctx: RequestContext, delivery: ManualDigitalDelivery): Promise<void> {
        if (delivery.expectedAt.getTime() > Date.now()) return Promise.resolve();
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_RESOLVED',
                eventType: 'commerce.fulfillment.manual_delivery_overdue',
                category: 'FULFILLMENT',
                severity: 'P2',
                fingerprint: `commerce.fulfillment.manual_delivery_overdue:${delivery.id}`,
                title: '人工交付超时已恢复',
                payload: { deliveryId: String(delivery.id), state: delivery.state },
            }),
        );
    }
}

function safeOperationalError(value: unknown): string {
    return String(value)
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}
