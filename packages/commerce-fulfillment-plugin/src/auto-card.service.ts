import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { ContentTranslationService, isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import {
    EventBus,
    isGraphQlErrorResult,
    Logger,
    Order,
    orderItemsAreDelivered,
    orderItemsArePartiallyDelivered,
    OrderLine,
    OrderService,
    Product,
    ProductVariantService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { In, IsNull, LockNotSupportedOnGivenDriverError } from 'typeorm';

import { AutoCardCipherService } from './auto-card-cipher.service';
import { AutoCardDeliveryReadyEvent } from './auto-card-delivery.event';
import {
    AutoCardFieldDefinition,
    autoCardFieldLabel,
    maskAutoCardValues,
    normalizeAutoCardDelimiter,
    parseAutoCardFieldsJson,
    parseAutoCardRows,
    validateAutoCardFields,
} from './auto-card-format';
import { autoCardFulfillmentHandler } from './auto-card-fulfillment-handler';
import { AUTO_CARD_MAX_INSTRUCTIONS_LENGTH, AutoCardDeliveryEventType } from './auto-card.constants';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDeliveryEvent } from './entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { isAutoCardOrderLine } from './fulfillment-classification';
import { orderLineProductName } from './order-line-snapshot';
import {
    AutoCardDeliveryListOptions,
    AutoCardImportInput,
    AutoCardPoolItemListOptions,
    UpdateAutoCardConfigInput,
} from './types';

const loggerCtx = 'AutoCardService';
const MAX_ADMIN_PAGE_SIZE = 100;
const MAX_EMAIL_ATTEMPTS = 5;
const MANUAL_RETRY_DEDUPLICATION_WINDOW_MS = 30_000;

export interface AutoCardConfigView extends AutoCardConfig {
    fields: AutoCardFieldDefinition[];
    availableCount: number;
    assignedCount: number;
    disabledCount: number;
    waitingDeliveryCount: number;
}

export interface AutoCardDisplayField extends AutoCardFieldDefinition {
    value: string;
}

export interface AutoCardPoolItemView extends AutoCardPoolItem {
    maskedFields: AutoCardDisplayField[];
}

export interface AutoCardImportPreview {
    validCount: number;
    invalidCount: number;
    rows: Array<{ lineNumber: number; fields: AutoCardDisplayField[] }>;
    errors: Array<{ lineNumber: number; message: string }>;
}

export interface AutoCardImportResult {
    importedCount: number;
    duplicateCount: number;
    availableCount: number;
}

export interface AutoCardEmailPayload {
    deliveryId: string;
    recipientEmail: string;
    orderCode: string;
    productName: string;
    sku: string;
    isChinese: boolean;
    instructions: string;
    credentials: Array<{ number: number; rawPayload: string; fields: AutoCardDisplayField[] }>;
}

@Injectable()
export class AutoCardService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: AutoCardCipherService,
        private readonly eventBus: EventBus,
        private readonly productVariantService: ProductVariantService,
        private readonly orderService: OrderService,
        private readonly requestContextService: RequestContextService,
        private readonly contentTranslations: ContentTranslationService,
    ) {}

    async configForVariant(ctx: RequestContext, productVariantId: ID): Promise<AutoCardConfigView | null> {
        const config = await this.findConfig(ctx, productVariantId);
        return config ? this.configView(ctx, config) : null;
    }

    async availableStockForVariant(ctx: RequestContext, productVariantId: ID): Promise<number | null> {
        const config = await this.findConfig(ctx, productVariantId);
        if (!config?.enabled) return null;
        return this.connection.getRepository(ctx, AutoCardPoolItem).count({
            where: { configId: config.id, state: 'AVAILABLE' },
        });
    }

    publicDeliveriesForOrder(ctx: RequestContext, orderId: ID): Promise<AutoCardDelivery[]> {
        return this.connection.getRepository(ctx, AutoCardDelivery).find({
            where: { channelId: ctx.channelId, orderId },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
                state: true,
                productName: true,
                sku: true,
                quantity: true,
                attemptCount: true,
                sentAt: true,
                orderLineId: true,
            },
            order: { createdAt: 'ASC' },
        });
    }

    async updateConfig(ctx: RequestContext, input: UpdateAutoCardConfigInput): Promise<AutoCardConfigView> {
        const variant = await this.productVariantService.findOne(ctx, input.productVariantId);
        if (!variant) {
            throw new UserInputError('商品 SKU 不存在或不属于当前店铺');
        }
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: variant.productId },
        });
        if (product?.customFields?.fulfillmentType !== 'digital') {
            throw new UserInputError('只有虚拟商品 SKU 才能启用号池自动发卡');
        }
        const repository = this.connection.getRepository(ctx, AutoCardConfig);
        let config = await repository.findOne({
            where: { channelId: ctx.channelId, productVariantId: input.productVariantId },
        });
        const existingFields = config ? parseAutoCardFieldsJson(config.fieldsJson) : [];
        const sourceInstructions = (input.instructionsZh ?? input.instructions ?? '').trim();
        const existingInstructionsZh = config?.instructionsZh ?? config?.instructions ?? '';
        const prepared = await this.contentTranslations.prepareLocalizedFields([
            ...input.fields.map(field => {
                const existingField = existingFields.find(candidate => candidate.key === field.key);
                return {
                    path: `fields.${field.key}.label`,
                    sourceText: field.label,
                    targetText: field.labelEn,
                    existingSourceText: existingField?.label,
                    existingTargetText: existingField?.labelEn,
                    required: true,
                };
            }),
            {
                path: 'instructions',
                sourceText: sourceInstructions,
                targetText: input.instructionsEn,
                existingSourceText: existingInstructionsZh,
                existingTargetText: config?.instructionsEn,
                format: 'HTML' as const,
            },
        ]);
        const english = new Map(prepared.map(field => [field.path, field.translatedText]));
        const fields = validateAutoCardFields(
            input.fields.map(field => ({
                ...field,
                labelEn: english.get(`fields.${field.key}.label`) ?? '',
            })),
        );
        const delimiter = normalizeAutoCardDelimiter(input.delimiter);
        const formatName = input.formatName.trim();
        const instructionsZh = sourceInstructions;
        const instructionsEn = english.get('instructions') ?? '';
        const instructions = instructionsZh || instructionsEn;
        if (!formatName || formatName.length > 80) {
            throw new UserInputError('发卡格式名称不能为空且不能超过 80 个字符');
        }
        if (
            instructionsZh.length > AUTO_CARD_MAX_INSTRUCTIONS_LENGTH ||
            instructionsEn.length > AUTO_CARD_MAX_INSTRUCTIONS_LENGTH
        ) {
            throw new UserInputError(
                `发货说明及其英文译文均不能超过 ${AUTO_CARD_MAX_INSTRUCTIONS_LENGTH} 个字符`,
            );
        }
        if (input.enabled && (!instructionsZh || !instructionsEn)) {
            throw new UserInputError('启用自动发卡前请填写发货说明；英文会在保存时自动生成');
        }
        if (
            !Number.isInteger(input.lowStockThreshold) ||
            input.lowStockThreshold < 0 ||
            input.lowStockThreshold > 1_000_000
        ) {
            throw new UserInputError('低库存预警数量必须为 0 至 1000000 的整数');
        }

        const values = {
            enabled: input.enabled,
            formatName,
            delimiter,
            fieldsJson: JSON.stringify(fields),
            instructions,
            instructionsZh,
            instructionsEn,
            lowStockThreshold: input.lowStockThreshold,
            channel: ctx.channel,
            channelId: ctx.channelId,
            productVariant: variant,
            productVariantId: variant.id,
        };
        config = await repository.save(config ? Object.assign(config, values) : new AutoCardConfig(values));
        await this.contentTranslations.recordPreparedFields(
            ctx,
            {
                channelId: ctx.channelId,
                entityType: AutoCardConfig.name,
                entityId: config.id,
            },
            prepared,
        );

        await this.productVariantService.update(ctx, [
            {
                id: variant.id,
                trackInventory: 'FALSE' as any,
                customFields: {
                    ...variant.customFields,
                    fulfillmentType: 'digital',
                    digitalDeliveryMode: 'auto_card',
                    digitalStockPolicy: 'pool_derived',
                },
            },
        ]);
        if (config.enabled) {
            await this.reconcileVariant(ctx, config.productVariantId);
        }
        return this.configView(ctx, config);
    }

    async previewImport(ctx: RequestContext, input: AutoCardImportInput): Promise<AutoCardImportPreview> {
        const config = await this.configOrThrow(ctx, input.productVariantId);
        const fields = parseAutoCardFieldsJson(config.fieldsJson);
        const parsed = parseAutoCardRows(input.rawText, fields, config.delimiter);
        return {
            validCount: parsed.rows.length,
            invalidCount: parsed.errors.length,
            rows: parsed.rows.slice(0, 20).map(row => ({
                lineNumber: row.lineNumber,
                fields: maskAutoCardValues(row.values, fields),
            })),
            errors: parsed.errors.slice(0, 100),
        };
    }

    async importPoolItems(ctx: RequestContext, input: AutoCardImportInput): Promise<AutoCardImportResult> {
        const config = await this.configOrThrow(ctx, input.productVariantId);
        const fields = parseAutoCardFieldsJson(config.fieldsJson);
        const parsed = parseAutoCardRows(input.rawText, fields, config.delimiter);
        if (parsed.errors.length) {
            const first = parsed.errors[0];
            throw new UserInputError(`第 ${first.lineNumber} 行：${first.message}；请修正后重新预览`);
        }

        const repository = this.connection.getRepository(ctx, AutoCardPoolItem);
        const uniqueRows: typeof parsed.rows = [];
        const fingerprints = new Set<string>();
        let duplicateCount = 0;
        for (const row of parsed.rows) {
            const fingerprint = this.cipher.fingerprint(config.id, row.values);
            if (fingerprints.has(fingerprint)) {
                duplicateCount++;
                continue;
            }
            fingerprints.add(fingerprint);
            uniqueRows.push(row);
        }

        const existingFingerprints = new Set<string>();
        const allFingerprints = [...fingerprints];
        for (let index = 0; index < allFingerprints.length; index += 500) {
            const existing = await repository.find({
                where: { configId: config.id, fingerprint: In(allFingerprints.slice(index, index + 500)) },
                select: ['fingerprint'],
            });
            existing.forEach(item => existingFingerprints.add(item.fingerprint));
        }
        duplicateCount += existingFingerprints.size;

        const maxSequenceResult = await repository
            .createQueryBuilder('item')
            .select('MAX(item.sequence)', 'maximum')
            .where('item.configId = :configId', { configId: config.id })
            .getRawOne<{ maximum?: string | number | null }>();
        let sequence = Number(maxSequenceResult?.maximum ?? 0);
        const items = uniqueRows
            .filter(row => !existingFingerprints.has(this.cipher.fingerprint(config.id, row.values)))
            .map(
                row =>
                    new AutoCardPoolItem({
                        config,
                        configId: config.id,
                        state: 'AVAILABLE',
                        sequence: ++sequence,
                        encryptedPayload: this.cipher.encrypt(row.values),
                        encryptedRawPayload: this.cipher.encrypt({ rawPayload: row.rawPayload }),
                        fingerprint: this.cipher.fingerprint(config.id, row.values),
                        assignedAt: null,
                        disabledReason: null,
                        delivery: null,
                        deliveryId: null,
                    }),
            );
        for (let index = 0; index < items.length; index += 500) {
            await repository.save(items.slice(index, index + 500), { reload: false });
        }

        await this.reconcileVariant(ctx, config.productVariantId);
        return {
            importedCount: items.length,
            duplicateCount,
            availableCount: await repository.count({ where: { configId: config.id, state: 'AVAILABLE' } }),
        };
    }

    async poolItems(
        ctx: RequestContext,
        productVariantId: ID,
        options: AutoCardPoolItemListOptions = {},
    ): Promise<{ items: AutoCardPoolItemView[]; totalItems: number }> {
        const config = await this.findConfig(ctx, productVariantId);
        if (!config) {
            return { items: [], totalItems: 0 };
        }
        const skip = boundedInteger(options.skip, 0, 0, 1_000_000);
        const take = boundedInteger(options.take, 20, 1, MAX_ADMIN_PAGE_SIZE);
        const repository = this.connection.getRepository(ctx, AutoCardPoolItem);
        const [items, totalItems] = await repository.findAndCount({
            where: { configId: config.id, ...(options.state ? { state: options.state } : {}) },
            relations: { delivery: true },
            order: { sequence: 'ASC' },
            skip,
            take,
        });
        const fields = parseAutoCardFieldsJson(config.fieldsJson);
        return {
            items: items.map(item =>
                Object.assign(item, {
                    maskedFields: maskAutoCardValues(this.cipher.decrypt(item.encryptedPayload), fields),
                }),
            ),
            totalItems,
        };
    }

    async revealPoolItem(ctx: RequestContext, id: ID): Promise<AutoCardDisplayField[]> {
        const item = await this.ownedPoolItemOrThrow(ctx, id);
        const fields = parseAutoCardFieldsJson(item.config.fieldsJson);
        const values = this.cipher.decrypt(item.encryptedPayload);
        return fields.map(field => ({ ...field, value: values[field.key] ?? '' }));
    }

    async setPoolItemEnabled(
        ctx: RequestContext,
        id: ID,
        enabled: boolean,
        reason = '',
    ): Promise<AutoCardPoolItemView> {
        const item = await this.ownedPoolItemOrThrow(ctx, id);
        if (item.state === 'ASSIGNED') {
            throw new UserInputError('已分配的卡密不能恢复或停用');
        }
        item.state = enabled ? 'AVAILABLE' : 'DISABLED';
        item.disabledReason = enabled ? null : reason.trim().slice(0, 2_000) || '管理员停用';
        const saved = await this.connection.getRepository(ctx, AutoCardPoolItem).save(item);
        if (enabled) {
            await this.reconcileVariant(ctx, item.config.productVariantId);
        }
        const fields = parseAutoCardFieldsJson(item.config.fieldsJson);
        return Object.assign(saved, {
            maskedFields: maskAutoCardValues(this.cipher.decrypt(saved.encryptedPayload), fields),
        });
    }

    async deliveries(
        ctx: RequestContext,
        options: AutoCardDeliveryListOptions = {},
    ): Promise<{ items: AutoCardDelivery[]; totalItems: number }> {
        const skip = boundedInteger(options.skip, 0, 0, 1_000_000);
        const take = boundedInteger(options.take, 20, 1, MAX_ADMIN_PAGE_SIZE);
        const [items, totalItems] = await this.connection.getRepository(ctx, AutoCardDelivery).findAndCount({
            where: {
                channelId: ctx.channelId,
                ...(options.state ? { state: options.state } : {}),
                ...(options.orderId ? { orderId: options.orderId } : {}),
                ...(options.productVariantId
                    ? { config: { productVariantId: options.productVariantId } }
                    : {}),
            },
            relations: { order: true, orderLine: true, poolItems: true, events: true, config: true },
            order: { createdAt: 'DESC', events: { createdAt: 'ASC' } },
            skip,
            take,
        });
        return { items, totalItems };
    }

    async todoSummary(ctx: RequestContext): Promise<{
        lowStockSkuCount: number;
        waitingStockDeliveryCount: number;
        manualReviewCount: number;
    }> {
        const configRows = await this.connection
            .getRepository(ctx, AutoCardConfig)
            .createQueryBuilder('config')
            .leftJoin(
                AutoCardPoolItem,
                'pool',
                'pool.configId = config.id AND pool.state = :availableState',
                { availableState: 'AVAILABLE' },
            )
            .select('config.id', 'id')
            .addSelect('config.lowStockThreshold', 'lowStockThreshold')
            .addSelect('COUNT(pool.id)', 'availableCount')
            .where('config.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('config.enabled = :enabled', { enabled: true })
            .groupBy('config.id')
            .addGroupBy('config.lowStockThreshold')
            .getRawMany<{ lowStockThreshold: string | number; availableCount: string | number }>();
        const deliveryRepository = this.connection.getRepository(ctx, AutoCardDelivery);
        const [waitingStockDeliveryCount, manualReviewCount] = await Promise.all([
            deliveryRepository.count({ where: { channelId: ctx.channelId, state: 'WAITING_STOCK' } }),
            deliveryRepository.count({ where: { channelId: ctx.channelId, state: 'MANUAL_REVIEW' } }),
        ]);
        return {
            lowStockSkuCount: configRows.filter(
                row => Number(row.availableCount) <= Number(row.lowStockThreshold),
            ).length,
            waitingStockDeliveryCount,
            manualReviewCount,
        };
    }

    async availabilityError(ctx: RequestContext, order: Pick<Order, 'lines'>): Promise<string | undefined> {
        const requiredByVariant = new Map<string, { variantId: ID; name: string; quantity: number }>();
        for (const line of order.lines.filter(isAutoCardOrderLine)) {
            const key = String(line.productVariant.id);
            const current = requiredByVariant.get(key);
            requiredByVariant.set(key, {
                variantId: line.productVariant.id,
                name: line.productVariant.name,
                quantity: (current?.quantity ?? 0) + line.quantity,
            });
        }
        for (const required of requiredByVariant.values()) {
            const config = await this.findConfig(ctx, required.variantId);
            if (!config?.enabled) {
                return `虚拟商品“${required.name}”的自动发卡未启用`;
            }
            const available = await this.connection.getRepository(ctx, AutoCardPoolItem).count({
                where: { configId: config.id, state: 'AVAILABLE' },
            });
            if (available < required.quantity) {
                return `虚拟商品“${required.name}”号池库存不足，当前可用 ${available} 份`;
            }
        }
    }

    async allocateSettledOrder(ctx: RequestContext, order: Order): Promise<AutoCardDelivery[]> {
        if (order.state !== 'PaymentSettled') {
            return [];
        }
        const recipientEmail =
            order.customFields?.deliveryEmail?.trim() || order.customer?.emailAddress?.trim();
        if (!recipientEmail) {
            throw new Error('自动发卡订单缺少交付邮箱');
        }
        const deliveries: AutoCardDelivery[] = [];
        for (const line of order.lines.filter(isAutoCardOrderLine)) {
            const existing = await this.connection.getRepository(ctx, AutoCardDelivery).findOne({
                where: { orderLineId: line.id },
                relations: { poolItems: true, config: true },
            });
            if (existing) {
                deliveries.push(existing);
                const staleDispatch =
                    !existing.lastDispatchedAt ||
                    Date.now() - existing.lastDispatchedAt.getTime() > 15 * 60_000;
                if (['ALLOCATED', 'RETRYING'].includes(existing.state) && staleDispatch) {
                    await this.dispatch(ctx, existing, 'EMAIL_QUEUED', '重用已分配卡密继续发送');
                }
                continue;
            }
            const config = await this.findConfig(ctx, line.productVariant.id);
            if (!config) {
                throw new Error(`SKU ${line.productVariant.sku} 未配置自动发卡`);
            }
            let delivery: AutoCardDelivery;
            try {
                delivery = await this.createAndAllocate(ctx, order, line, config, recipientEmail);
            } catch (error) {
                const concurrentDelivery = await this.connection
                    .getRepository(ctx, AutoCardDelivery)
                    .findOne({
                        where: { orderLineId: line.id },
                        relations: { poolItems: true, config: true },
                    });
                if (!concurrentDelivery) {
                    throw error;
                }
                delivery = concurrentDelivery;
            }
            deliveries.push(delivery);
            if (delivery.state === 'ALLOCATED') {
                await this.dispatch(ctx, delivery, 'EMAIL_QUEUED', '卡密已进入邮件发送队列');
            }
        }
        return deliveries;
    }

    async emailPayload(ctx: RequestContext, deliveryId: ID): Promise<AutoCardEmailPayload> {
        const delivery = await this.deliveryOrThrow(ctx, deliveryId);
        if (!['ALLOCATED', 'RETRYING', 'SENT'].includes(delivery.state)) {
            throw new Error('当前发卡记录尚未分配卡密');
        }
        if (delivery.poolItems.length !== delivery.quantity) {
            delivery.state = 'MANUAL_REVIEW';
            delivery.lastError = `发卡数量异常：订单需要 ${delivery.quantity} 份，实际绑定 ${delivery.poolItems.length} 份`;
            await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
            await this.addEvent(ctx, delivery, 'MANUAL_REVIEW', delivery.lastError);
            await this.publishDeliveryFailure(ctx, delivery, delivery.lastError);
            throw new Error(delivery.lastError);
        }
        const fields = parseAutoCardFieldsJson(delivery.schemaSnapshot);
        const isChinese = delivery.languageCode === 'zh_Hans';
        return {
            deliveryId: String(delivery.id),
            recipientEmail: delivery.recipientEmail,
            orderCode: delivery.order.code,
            productName: delivery.productName,
            sku: delivery.sku,
            isChinese,
            instructions: delivery.instructionsSnapshot,
            credentials: delivery.poolItems
                .slice()
                .sort((left, right) => left.sequence - right.sequence)
                .map((item, index) => {
                    const values = this.cipher.decrypt(item.encryptedPayload);
                    return {
                        number: index + 1,
                        rawPayload: item.encryptedRawPayload
                            ? (this.cipher.decrypt(item.encryptedRawPayload).rawPayload ?? '')
                            : fields.map(field => values[field.key] ?? '').join(delivery.config.delimiter),
                        fields: fields.map(field => ({
                            ...field,
                            label: autoCardFieldLabel(field, isChinese),
                            value: values[field.key] ?? '',
                        })),
                    };
                }),
        };
    }

    async recordEmailResult(
        ctx: RequestContext,
        deliveryId: ID,
        success: boolean,
        error?: Error,
    ): Promise<void> {
        const delivery = await this.deliveryOrThrow(ctx, deliveryId);
        const wasManualReview = delivery.state === 'MANUAL_REVIEW';
        if (!success && delivery.state === 'SENT') {
            await this.addEvent(ctx, delivery, 'EMAIL_FAILED', '重复投递失败，原发卡成功状态保持不变');
            return;
        }
        delivery.attemptCount += 1;
        if (success) {
            delivery.state = 'SENT';
            delivery.sentAt = new Date();
            delivery.lastError = null;
            await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
            await this.addEvent(ctx, delivery, 'EMAIL_SENT', '自动发卡邮件已发送');
            if (wasManualReview) await this.resolveDeliveryFailure(ctx, delivery);
            await this.completeFulfillment(ctx, delivery);
            return;
        }
        delivery.lastError = String(error?.message ?? '邮件发送失败').slice(0, 2_000);
        delivery.state = delivery.attemptCount >= MAX_EMAIL_ATTEMPTS ? 'MANUAL_REVIEW' : 'RETRYING';
        await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
        await this.addEvent(
            ctx,
            delivery,
            delivery.state === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'EMAIL_FAILED',
            delivery.state === 'MANUAL_REVIEW'
                ? '邮件多次发送失败，已转人工处理'
                : '邮件发送失败，系统将继续重试',
        );
        if (delivery.state === 'MANUAL_REVIEW') {
            await this.publishDeliveryFailure(ctx, delivery, delivery.lastError);
        }
    }

    async retryDelivery(ctx: RequestContext, id: ID): Promise<AutoCardDelivery> {
        let delivery = await this.lockDeliveryOrThrow(ctx, id);
        if (delivery.state === 'WAITING_STOCK') {
            delivery = await this.allocateExistingDelivery(ctx, delivery);
        }
        if (!['ALLOCATED', 'RETRYING', 'SENT', 'MANUAL_REVIEW'].includes(delivery.state)) {
            throw new UserInputError('当前发卡状态不支持重新发送');
        }
        const recentlyDispatched =
            delivery.lastDispatchedAt != null &&
            Date.now() - delivery.lastDispatchedAt.getTime() < MANUAL_RETRY_DEDUPLICATION_WINDOW_MS;
        const dispatchStillPending =
            recentlyDispatched &&
            (delivery.state === 'SENT' || (delivery.state === 'RETRYING' && !delivery.lastError));
        if (dispatchStillPending) {
            throw new UserInputError('重发请求已进入邮件队列，请勿重复提交');
        }
        if (delivery.state !== 'SENT') {
            delivery.state = 'RETRYING';
            delivery.lastError = null;
            await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
        }
        await this.addEvent(ctx, delivery, 'MANUAL_RETRY', '管理员手动重新发送原卡密', 'ADMIN');
        await this.dispatch(ctx, delivery, 'EMAIL_QUEUED', '手动重发已进入邮件队列');
        return delivery;
    }

    async reconcilePending(): Promise<{
        allocated: number;
        redispatched: number;
        completedFulfillments: number;
    }> {
        const repository = this.connection.rawConnection.getRepository(AutoCardDelivery);
        const pending = await repository.find({
            where: [
                { state: In(['WAITING_STOCK', 'ALLOCATED', 'RETRYING']) },
                { state: 'SENT', fulfillmentId: IsNull() },
            ],
            relations: {
                channel: true,
                order: true,
                orderLine: { productVariant: true },
                config: true,
                poolItems: true,
            },
            order: { createdAt: 'ASC' },
            take: 200,
        });
        let allocated = 0;
        let redispatched = 0;
        let completedFulfillments = 0;
        for (const item of pending) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: item.channel,
            });
            try {
                let delivery = item;
                if (delivery.state === 'SENT' && !delivery.fulfillmentId) {
                    await this.completeFulfillment(ctx, delivery);
                    completedFulfillments++;
                    continue;
                }
                if (delivery.state === 'WAITING_STOCK') {
                    delivery = await this.allocateExistingDelivery(ctx, delivery);
                    if (delivery.state === 'ALLOCATED') allocated++;
                }
                const stale =
                    !delivery.lastDispatchedAt ||
                    Date.now() - delivery.lastDispatchedAt.getTime() > 15 * 60_000;
                if (['ALLOCATED', 'RETRYING'].includes(delivery.state) && stale) {
                    await this.dispatch(ctx, delivery, 'EMAIL_QUEUED', '定时检查重新投递发卡邮件');
                    redispatched++;
                }
            } catch (error) {
                Logger.error(error instanceof Error ? error.message : String(error), loggerCtx);
            }
        }
        return { allocated, redispatched, completedFulfillments };
    }

    private async reconcileVariant(ctx: RequestContext, productVariantId: ID): Promise<void> {
        const waiting = await this.connection.getRepository(ctx, AutoCardDelivery).find({
            where: { channelId: ctx.channelId, state: 'WAITING_STOCK', config: { productVariantId } },
            relations: { config: true, order: true, orderLine: { productVariant: true }, poolItems: true },
            order: { createdAt: 'ASC' },
            take: 100,
        });
        for (const delivery of waiting) {
            const allocated = await this.allocateExistingDelivery(ctx, delivery);
            if (allocated.state === 'ALLOCATED') {
                await this.dispatch(ctx, allocated, 'EMAIL_QUEUED', '补货后自动恢复发卡');
            }
        }
    }

    private async createAndAllocate(
        ctx: RequestContext,
        order: Order,
        line: OrderLine,
        config: AutoCardConfig,
        recipientEmail: string,
    ): Promise<AutoCardDelivery> {
        const delivery = await this.connection.getRepository(ctx, AutoCardDelivery).save(
            new AutoCardDelivery({
                state: 'WAITING_STOCK',
                recipientEmail,
                languageCode: String(ctx.languageCode),
                productName: orderLineProductName(ctx, line),
                sku: line.productVariant.sku,
                quantity: line.quantity,
                schemaSnapshot: config.fieldsJson,
                instructionsSnapshot: this.localizedInstructions(config, String(ctx.languageCode)),
                attemptCount: 0,
                lastError: null,
                lastDispatchedAt: null,
                sentAt: null,
                fulfillmentId: null,
                channel: ctx.channel,
                channelId: ctx.channelId,
                order,
                orderId: order.id,
                orderLine: line,
                orderLineId: line.id,
                config,
                configId: config.id,
                poolItems: [],
                events: [],
            }),
        );
        return this.allocateExistingDelivery(ctx, delivery);
    }

    private async allocateExistingDelivery(
        ctx: RequestContext,
        input: AutoCardDelivery,
    ): Promise<AutoCardDelivery> {
        const delivery = await this.deliveryOrThrow(ctx, input.id);
        if (delivery.poolItems.length === delivery.quantity) {
            if (delivery.state !== 'SENT') {
                delivery.state = 'ALLOCATED';
                return this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
            }
            return delivery;
        }
        if (delivery.poolItems.length > delivery.quantity) {
            delivery.state = 'MANUAL_REVIEW';
            delivery.lastError = '已分配卡密数量超过订单数量，需要人工核查';
            await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
            await this.addEvent(ctx, delivery, 'MANUAL_REVIEW', delivery.lastError);
            await this.publishDeliveryFailure(ctx, delivery, delivery.lastError);
            return delivery;
        }
        const remainingQuantity = delivery.quantity - delivery.poolItems.length;
        const repository = this.connection.getRepository(ctx, AutoCardPoolItem);
        let candidates: AutoCardPoolItem[];
        try {
            candidates = await repository
                .createQueryBuilder('item')
                .setLock('pessimistic_write')
                .where('item.configId = :configId', { configId: delivery.configId })
                .andWhere('item.state = :state', { state: 'AVAILABLE' })
                .orderBy('item.sequence', 'ASC')
                .addOrderBy('item.id', 'ASC')
                .take(remainingQuantity)
                .getMany();
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
            candidates = await repository.find({
                where: { configId: delivery.configId, state: 'AVAILABLE' },
                order: { sequence: 'ASC', id: 'ASC' },
                take: remainingQuantity,
            });
        }
        if (candidates.length < remainingQuantity) {
            delivery.state = 'WAITING_STOCK';
            delivery.lastError = `号池还需要 ${remainingQuantity} 份，当前可用 ${candidates.length} 份`;
            await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
            if (!delivery.events.some(event => event.type === 'WAITING_STOCK')) {
                await this.addEvent(ctx, delivery, 'WAITING_STOCK', delivery.lastError);
            }
            await this.publishStockShortage(ctx, delivery, candidates.length, remainingQuantity);
            return delivery;
        }
        const ids = candidates.map(item => item.id);
        const update = await repository
            .createQueryBuilder()
            .update(AutoCardPoolItem)
            .set({ state: 'ASSIGNED', assignedAt: new Date(), deliveryId: delivery.id })
            .whereInIds(ids)
            .andWhere('state = :available', { available: 'AVAILABLE' })
            .execute();
        if (update.affected !== remainingQuantity) {
            delivery.state = 'WAITING_STOCK';
            delivery.lastError = '号池发生并发分配，系统将自动重试';
            await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
            await this.addEvent(ctx, delivery, 'WAITING_STOCK', delivery.lastError);
            return delivery;
        }
        const wasWaitingForStock = delivery.events.some(event => event.type === 'WAITING_STOCK');
        delivery.state = 'ALLOCATED';
        delivery.lastError = null;
        delivery.poolItems = [
            ...delivery.poolItems,
            ...candidates.map(item =>
                Object.assign(item, {
                    state: 'ASSIGNED' as const,
                    assignedAt: new Date(),
                    deliveryId: delivery.id,
                }),
            ),
        ];
        await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
        await this.addEvent(ctx, delivery, 'ALLOCATED', `已按号池顺序分配 ${delivery.quantity} 份卡密`);
        if (wasWaitingForStock) await this.resolveStockShortage(ctx, delivery);
        return delivery;
    }

    private async dispatch(
        ctx: RequestContext,
        delivery: AutoCardDelivery,
        eventType: AutoCardDeliveryEventType,
        note: string,
    ): Promise<void> {
        delivery.lastDispatchedAt = new Date();
        await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);
        await this.addEvent(ctx, delivery, eventType, note);
        await this.eventBus.publish(new AutoCardDeliveryReadyEvent(ctx, String(delivery.id)));
    }

    private async completeFulfillment(ctx: RequestContext, delivery: AutoCardDelivery): Promise<void> {
        if (delivery.fulfillmentId) return;
        const result = await this.orderService.createFulfillment(ctx, {
            lines: [{ orderLineId: delivery.orderLineId, quantity: delivery.quantity }],
            handler: { code: autoCardFulfillmentHandler.code, arguments: [] },
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
        await this.connection.getRepository(ctx, AutoCardDelivery).save(delivery);

        const order = await this.connection.getEntityOrThrow(ctx, Order, delivery.orderId, {
            relations: [
                'lines',
                'lines.productVariant',
                'fulfillments',
                'fulfillments.lines',
                'fulfillments.lines.fulfillment',
            ],
        });
        const targetState = orderItemsAreDelivered(order)
            ? 'Delivered'
            : orderItemsArePartiallyDelivered(order)
              ? 'PartiallyDelivered'
              : undefined;
        if (targetState && this.orderService.getNextOrderStates(order).includes(targetState)) {
            const orderResult = await this.orderService.transitionToState(ctx, order.id, targetState);
            if (isGraphQlErrorResult(orderResult)) {
                throw new Error(orderResult.message);
            }
        }
    }

    private async configView(ctx: RequestContext, config: AutoCardConfig): Promise<AutoCardConfigView> {
        const poolRepository = this.connection.getRepository(ctx, AutoCardPoolItem);
        const deliveryRepository = this.connection.getRepository(ctx, AutoCardDelivery);
        const [availableCount, assignedCount, disabledCount, waitingDeliveryCount] = await Promise.all([
            poolRepository.count({ where: { configId: config.id, state: 'AVAILABLE' } }),
            poolRepository.count({ where: { configId: config.id, state: 'ASSIGNED' } }),
            poolRepository.count({ where: { configId: config.id, state: 'DISABLED' } }),
            deliveryRepository.count({ where: { configId: config.id, state: 'WAITING_STOCK' } }),
        ]);
        return Object.assign(config, {
            fields: parseAutoCardFieldsJson(config.fieldsJson),
            instructionsZh: config.instructionsZh ?? config.instructions ?? '',
            instructionsEn: config.instructionsEn ?? '',
            availableCount,
            assignedCount,
            disabledCount,
            waitingDeliveryCount,
        });
    }

    private findConfig(ctx: RequestContext, productVariantId: ID): Promise<AutoCardConfig | null> {
        return this.connection.getRepository(ctx, AutoCardConfig).findOne({
            where: { channelId: ctx.channelId, productVariantId },
            relations: { productVariant: true },
        });
    }

    private localizedInstructions(config: AutoCardConfig, languageCode: string): string {
        if (languageCode === 'zh_Hans') {
            return (
                config.instructionsZh?.trim() ||
                config.instructions?.trim() ||
                config.instructionsEn?.trim() ||
                ''
            );
        }
        return isUsableEnglishTranslation(config.instructionsEn) ? config.instructionsEn.trim() : '';
    }

    private async configOrThrow(ctx: RequestContext, productVariantId: ID): Promise<AutoCardConfig> {
        const config = await this.findConfig(ctx, productVariantId);
        if (!config) throw new UserInputError('该 SKU 尚未配置自动发卡');
        return config;
    }

    private async ownedPoolItemOrThrow(ctx: RequestContext, id: ID): Promise<AutoCardPoolItem> {
        const item = await this.connection.getRepository(ctx, AutoCardPoolItem).findOne({
            where: { id, config: { channelId: ctx.channelId } },
            relations: { config: true, delivery: true },
        });
        if (!item) throw new UserInputError('号池记录不存在');
        return item;
    }

    private async deliveryOrThrow(ctx: RequestContext, id: ID): Promise<AutoCardDelivery> {
        const delivery = await this.connection.getRepository(ctx, AutoCardDelivery).findOne({
            where: { id, channelId: ctx.channelId },
            relations: {
                config: true,
                channel: true,
                order: true,
                orderLine: { productVariant: true },
                poolItems: true,
                events: true,
            },
            order: { events: { createdAt: 'ASC' } },
        });
        if (!delivery) throw new UserInputError('发卡记录不存在');
        return delivery;
    }

    private async lockDeliveryOrThrow(ctx: RequestContext, id: ID): Promise<AutoCardDelivery> {
        const repository = this.connection.getRepository(ctx, AutoCardDelivery);
        try {
            const locked = await repository
                .createQueryBuilder('delivery')
                .setLock('pessimistic_write')
                .where('delivery.id = :id', { id })
                .andWhere('delivery.channelId = :channelId', { channelId: ctx.channelId })
                .getOne();
            if (!locked) throw new UserInputError('发卡记录不存在');
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
        }
        return this.deliveryOrThrow(ctx, id);
    }

    private addEvent(
        ctx: RequestContext,
        delivery: AutoCardDelivery,
        type: AutoCardDeliveryEventType,
        note: string,
        actorType: 'SYSTEM' | 'ADMIN' = 'SYSTEM',
    ): Promise<AutoCardDeliveryEvent> {
        return this.connection.getRepository(ctx, AutoCardDeliveryEvent).save(
            new AutoCardDeliveryEvent({
                delivery,
                deliveryId: delivery.id,
                type,
                actorType,
                actorId: actorType === 'ADMIN' ? String(ctx.activeUserId ?? '') : null,
                note: note.slice(0, 2_000),
            }),
        );
    }

    private publishDeliveryFailure(
        ctx: RequestContext,
        delivery: AutoCardDelivery,
        reason: string,
    ): Promise<void> {
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_FIRING',
                eventType: 'commerce.fulfillment.auto_card_failed',
                category: 'FULFILLMENT',
                severity: 'P1',
                sourceType: 'AutoCardDelivery',
                sourceId: String(delivery.id),
                fingerprint: `commerce.fulfillment.auto_card_failed:${delivery.id}`,
                title: `自动发卡需要人工处理 · 订单 ${delivery.order?.code ?? delivery.orderId}`,
                payload: {
                    channelId: String(delivery.channelId),
                    deliveryId: String(delivery.id),
                    orderId: String(delivery.orderId),
                    orderCode: delivery.order?.code ?? null,
                    sku: delivery.sku,
                    quantity: delivery.quantity,
                    attemptCount: delivery.attemptCount,
                    reason: safeOperationalError(reason),
                    adminPath: '/catalog/card-pool',
                },
            }),
        );
    }

    private resolveDeliveryFailure(ctx: RequestContext, delivery: AutoCardDelivery): Promise<void> {
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_RESOLVED',
                eventType: 'commerce.fulfillment.auto_card_failed',
                category: 'FULFILLMENT',
                severity: 'P2',
                fingerprint: `commerce.fulfillment.auto_card_failed:${delivery.id}`,
                title: '自动发卡异常已恢复',
                payload: { deliveryId: String(delivery.id), state: delivery.state },
            }),
        );
    }

    private publishStockShortage(
        ctx: RequestContext,
        delivery: AutoCardDelivery,
        availableCount: number,
        requiredCount: number,
    ): Promise<void> {
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_FIRING',
                eventType: 'inventory.auto_card.empty',
                category: 'INVENTORY',
                severity: 'P0',
                sourceType: 'AutoCardConfig',
                sourceId: String(delivery.configId),
                fingerprint: `inventory.auto_card.empty:${delivery.channelId}:${delivery.configId}`,
                title: `自动发卡号池不足 · ${delivery.sku}`,
                payload: {
                    channelId: String(delivery.channelId),
                    configId: String(delivery.configId),
                    deliveryId: String(delivery.id),
                    orderId: String(delivery.orderId),
                    sku: delivery.sku,
                    availableCount,
                    requiredCount,
                    adminPath: '/catalog/card-pool',
                },
            }),
        );
    }

    private resolveStockShortage(ctx: RequestContext, delivery: AutoCardDelivery): Promise<void> {
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_RESOLVED',
                eventType: 'inventory.auto_card.empty',
                category: 'INVENTORY',
                severity: 'P2',
                fingerprint: `inventory.auto_card.empty:${delivery.channelId}:${delivery.configId}`,
                title: '自动发卡号池已恢复',
                payload: { configId: String(delivery.configId), sku: delivery.sku },
            }),
        );
    }
}

function isLockNotSupportedError(error: unknown): boolean {
    return (
        error instanceof LockNotSupportedOnGivenDriverError ||
        (error instanceof Error &&
            (error.name === 'LockNotSupportedOnGivenDriverError' ||
                error.message.toLowerCase().includes('locking not supported')))
    );
}

function safeOperationalError(value: unknown): string {
    return String(value)
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}

function boundedInteger(
    value: number | null | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, Number(value))) : fallback;
}
