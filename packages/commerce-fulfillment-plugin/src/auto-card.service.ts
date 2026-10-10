import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { ContentTranslationService, isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import {
    assertOrderSalesChannel,
    EventBus,
    FulfillmentLine,
    isGraphQlErrorResult,
    LanguageCode,
    Logger,
    Order,
    orderItemsAreDelivered,
    orderItemsArePartiallyDelivered,
    OrderLine,
    OrderService,
    Permission,
    Product,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    RequestContextCacheService,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import {
    CatalogGovernanceService,
    GovernanceService,
    StorefrontDataChangedEvent,
} from '@vendure/store-management-plugin';
import { randomUUID } from 'node:crypto';
import { In, IsNull, LockNotSupportedOnGivenDriverError } from 'typeorm';

import { AutoCardCipherService } from './auto-card-cipher.service';
import { AutoCardDeliveryReadyEvent } from './auto-card-delivery.event';
import { autoCardDisplayStock } from './auto-card-display-stock';
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
import { AutoCardSupplyService } from './auto-card-supply.service';
import {
    AUTO_CARD_MAX_INSTRUCTIONS_LENGTH,
    AutoCardDeliveryEventType,
    manageAutoCardSecretsPermission,
    readSoldAutoCardsPermission,
} from './auto-card.constants';
import { digitalDeliverableQuantity } from './digital-order-entitlement';
import { DigitalProductService } from './digital-product.service';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDeliveryEvent } from './entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { AutoCardSupplyGrant, AutoCardSupplySnapshot } from './entities/auto-card-supply-grant.entity';
import { isAutoCardOrderLine } from './fulfillment-classification';
import { OrderConfirmationTokenService } from './order-confirmation-token.service';
import { orderLineProductName } from './order-line-snapshot';
import { OrderProcessingChangedEvent } from './order-processing-changed.event';
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
        private readonly supply: AutoCardSupplyService,
        private readonly governance: CatalogGovernanceService,
        private readonly audit: GovernanceService,
        private readonly digitalProducts: DigitalProductService,
        private readonly receiptTokens: OrderConfirmationTokenService,
        private readonly requestCache: RequestContextCacheService = new RequestContextCacheService(),
    ) {}

    async configForVariant(ctx: RequestContext, productVariantId: ID): Promise<AutoCardConfigView | null> {
        const config = await this.findConfig(ctx, productVariantId);
        return config ? this.configView(ctx, config) : null;
    }

    async availableStockForVariant(ctx: RequestContext, productVariantId: ID): Promise<number | null> {
        const source = await this.supply.resolve(ctx, productVariantId);
        const config = source?.config;
        if (!config?.enabled) return null;
        return this.connection.getRepository(ctx, AutoCardPoolItem).count({
            where: { configId: config.id, state: 'AVAILABLE' },
        });
    }

    async availableStockForDisplay(ctx: RequestContext, variant: ProductVariant): Promise<number | null> {
        // Both records must explicitly classify this as physical. Older records
        // without the product relation retain the existing supply fallback.
        if (
            variant.customFields.fulfillmentType === 'physical' &&
            variant.product?.customFields.fulfillmentType === 'physical'
        )
            return null;
        const source = await this.supply.resolveForDisplay(ctx, variant.id);
        return source
            ? autoCardDisplayStock(ctx, source.config.id, this.connection, this.requestCache)
            : null;
    }

    publicDeliveriesForOrder(ctx: RequestContext, orderId: ID): Promise<AutoCardDelivery[]> {
        return this.connection.getRepository(ctx, AutoCardDelivery).find({
            where: { channelId: ctx.channelId, orderId, order: { salesChannelId: ctx.channelId } },
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
        await this.governance.assertOwned(ctx, 'Product', variant.productId);
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
        if (input.enabled && !instructionsZh) {
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
        await this.publishSupplyStockChange(ctx, config.id, config.productVariantId);
        await this.contentTranslations.recordPreparedFields(
            ctx,
            {
                channelId: ctx.channelId,
                entityType: AutoCardConfig.name,
                entityId: config.id,
            },
            prepared,
        );

        await this.digitalProducts.update(ctx, {
            productVariantId: variant.id,
            deliveryMode: 'auto_card',
            stockPolicy: 'pool_derived',
        });
        if (config.enabled) {
            await this.reconcileVariant(ctx, config.productVariantId);
            await this.publishSupplyStockChange(ctx, config.id, config.productVariantId);
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
        await this.publishSupplyStockChange(ctx, config.id, config.productVariantId);
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
            order: { sequence: 'ASC', id: 'ASC' },
            skip,
            take,
        });
        const fields = parseAutoCardFieldsJson(config.fieldsJson);
        return {
            items: items.map(item =>
                Object.assign(item, {
                    ...(item.delivery && String(item.delivery.channelId) !== String(ctx.channelId)
                        ? { delivery: null, deliveryId: null }
                        : {}),
                    maskedFields: maskAutoCardValues(this.cipher.decrypt(item.encryptedPayload), fields),
                }),
            ),
            totalItems,
        };
    }

    async revealSoldCards(ctx: RequestContext, id: ID): Promise<AutoCardDisplayField[][]> {
        if (
            !ctx.activeUserId ||
            !ctx.userHasPermissions([readSoldAutoCardsPermission.Permission, Permission.SuperAdmin])
        )
            throw new UserInputError('需要本单卡密查看专用权限');
        const delivery = await this.deliveryOrThrow(ctx, id);
        await this.audit.appendAudit(ctx, {
            eventType: 'AUTO_CARD_SOLD_SECRET_REVEALED',
            resourceType: 'AutoCardDelivery',
            resourceId: String(delivery.id),
            actorType: 'ADMIN',
            actorUserId: String(ctx.activeUserId),
            actorLabel: String(ctx.activeUserId),
            reason: '查看本店订单已分配卡密',
            payload: { orderId: String(delivery.orderId), quantity: delivery.poolItems.length },
            idempotencyKey: randomUUID(),
        });
        await this.addEvent(ctx, delivery, 'SECRET_REVEALED', '经专用权限查看本店订单已分配卡密', 'ADMIN');
        const fields = parseAutoCardFieldsJson(delivery.schemaSnapshot);
        return delivery.poolItems.map(item => {
            const values = this.cipher.decrypt(item.encryptedPayload);
            return fields.map(field => ({ ...field, value: values[field.key] ?? '' }));
        });
    }

    async revealPoolItem(ctx: RequestContext, id: ID): Promise<AutoCardDisplayField[]> {
        if (
            !ctx.activeUserId ||
            !ctx.userHasPermissions([manageAutoCardSecretsPermission.Permission, Permission.SuperAdmin])
        )
            throw new UserInputError('需要卡池明文查看专用权限');
        const item = await this.ownedPoolItemOrThrow(ctx, id);
        await this.audit.appendAudit(ctx, {
            eventType: 'AUTO_CARD_POOL_SECRET_REVEALED',
            resourceType: 'AutoCardPoolItem',
            resourceId: String(item.id),
            actorType: 'ADMIN',
            actorUserId: String(ctx.activeUserId),
            actorLabel: String(ctx.activeUserId),
            reason: '查看维护店铺卡池卡密',
            payload: { configId: String(item.configId) },
            idempotencyKey: randomUUID(),
        });
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
        if (['ASSIGNED', 'RESERVED'].includes(item.state)) {
            throw new UserInputError('已分配或结算占用的卡密不能恢复或停用');
        }
        item.state = enabled ? 'AVAILABLE' : 'DISABLED';
        item.disabledReason = enabled ? null : reason.trim().slice(0, 2_000) || '管理员停用';
        const saved = await this.connection.getRepository(ctx, AutoCardPoolItem).save(item);
        if (enabled) {
            await this.reconcileVariant(ctx, item.config.productVariantId);
        }
        await this.publishSupplyStockChange(ctx, item.configId, item.config.productVariantId);
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
                order: { salesChannelId: ctx.channelId },
                ...(options.state ? { state: options.state } : {}),
                ...(options.orderId ? { orderId: options.orderId } : {}),
                ...(options.productVariantId
                    ? { config: { productVariantId: options.productVariantId } }
                    : {}),
            },
            relations: { order: true, orderLine: true, poolItems: true, events: true, config: true },
            order: { createdAt: 'DESC', id: 'DESC', events: { createdAt: 'ASC' } },
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
            .addSelect('config.productVariantId', 'productVariantId')
            .addSelect('config.lowStockThreshold', 'lowStockThreshold')
            .addSelect('COUNT(pool.id)', 'availableCount')
            .where('config.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('config.enabled = :enabled', { enabled: true })
            .groupBy('config.id')
            .addGroupBy('config.productVariantId')
            .addGroupBy('config.lowStockThreshold')
            .getRawMany<{
                id: ID;
                productVariantId: ID;
                lowStockThreshold: string | number;
                availableCount: string | number;
            }>();
        const lowStockRows = configRows.filter(
            row => Number(row.availableCount) <= Number(row.lowStockThreshold),
        );
        const variants = lowStockRows.length
            ? await this.connection.getRepository(ctx, ProductVariant).find({
                  where: {
                      id: In(lowStockRows.map(row => row.productVariantId)),
                      channels: { id: ctx.channelId },
                      deletedAt: IsNull(),
                  },
                  relations: ['product'],
                  loadEagerRelations: false,
              })
            : [];
        const variantById = new Map(variants.map(variant => [String(variant.id), variant]));
        // A retained pool is historical data, not evidence that the current SKU
        // still uses auto-card delivery. Active, store-scoped digital settings
        // take precedence over the legacy variant fields, as in the storefront.
        const activeLowStockRows = await Promise.all(
            lowStockRows.map(async row => {
                const variant = variantById.get(String(row.productVariantId));
                if (
                    !variant ||
                    variant.deletedAt ||
                    !variant.product ||
                    variant.product.deletedAt ||
                    variant.customFields.fulfillmentType === 'physical' ||
                    variant.product.customFields.fulfillmentType === 'physical'
                )
                    return false;
                // Product policy treats legacy missing type fields as digital;
                // the effective auto-card mode and supply checks remain required.
                const digital = await this.digitalProducts.configForDisplay(ctx, variant.id);
                if ((digital?.deliveryMode ?? variant.customFields.digitalDeliveryMode) !== 'auto_card')
                    return false;
                // Reuse the batched supply policy for current ownership and
                // sales authorization; a stale local pool must not bypass it.
                const source = await this.supply.resolveForDisplay(ctx, variant.id);
                return String(source?.config.id) === String(row.id);
            }),
        );
        const deliveryRepository = this.connection.getRepository(ctx, AutoCardDelivery);
        const [waitingStockDeliveryCount, manualReviewCount] = await Promise.all([
            deliveryRepository.count({ where: { channelId: ctx.channelId, state: 'WAITING_STOCK' } }),
            deliveryRepository.count({ where: { channelId: ctx.channelId, state: 'MANUAL_REVIEW' } }),
        ]);
        return {
            lowStockSkuCount: activeLowStockRows.filter(Boolean).length,
            waitingStockDeliveryCount,
            manualReviewCount,
        };
    }

    async availabilityError(ctx: RequestContext, order: Order): Promise<string | undefined> {
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
            const reserved = await Promise.all(
                order.lines
                    .filter(line => String(line.productVariantId) === String(required.variantId))
                    .map(line => this.digitalProducts.reservation(ctx, line.id)),
            );
            if (reserved.length && reserved.every(row => row?.state === 'HELD')) continue;
            const config = (await this.supply.resolve(ctx, required.variantId))?.config;
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
        for (const line of order.lines.filter(isAutoCardOrderLine)) {
            if (!(await this.supply.snapshotForPayment(ctx, order, line)))
                return '销售或供货授权已变化，请重新确认';
        }
    }

    async allocateSettledOrder(ctx: RequestContext, order: Order): Promise<AutoCardDelivery[]> {
        if (
            !['PaymentSettled', 'PartiallyDelivered', 'Delivered', 'PartiallyShipped', 'Shipped'].includes(
                order.state,
            )
        ) {
            return [];
        }
        assertOrderSalesChannel(ctx, order);
        if (!order.lines.some(isAutoCardOrderLine)) return [];
        const recipientEmail =
            order.customFields?.deliveryEmail?.trim() || order.customer?.emailAddress?.trim();
        if (!recipientEmail) {
            throw new Error('自动发卡订单缺少交付邮箱');
        }
        const deliveries: AutoCardDelivery[] = [];
        for (const line of order.lines.filter(isAutoCardOrderLine)) {
            const source = await this.supply.forPaidLine(ctx, order, line);
            if (source?.config && ['mysql', 'mariadb'].includes(this.connection.rawConnection.options.type)) {
                // Lock the common pool before delivery-index gaps, so A/B orders acquire locks in one order.
                await this.connection
                    .getRepository(ctx, AutoCardConfig)
                    .findOne({ where: { id: source.config.id }, lock: { mode: 'pessimistic_write' } });
            }
            // Serialize duplicate paid events on the line and use a current locking read under MySQL REPEATABLE READ.
            try {
                await this.connection.getRepository(ctx, OrderLine).findOne({
                    where: { id: line.id },
                    loadEagerRelations: false,
                    lock: { mode: 'pessimistic_write' },
                });
            } catch (error) {
                if (!isLockNotSupportedError(error)) throw error;
            }

            const existing = await this.connection.getRepository(ctx, AutoCardDelivery).findOne({
                where: { orderLineId: line.id },
                relations: { poolItems: true, config: true, order: true },
                ...(this.connection.rawConnection.options.type === 'mysql' ||
                this.connection.rawConnection.options.type === 'mariadb'
                    ? { lock: { mode: 'pessimistic_write' as const }, relationLoadStrategy: 'join' as const }
                    : {}),
            });
            if (existing) {
                this.assertDeliveryScope(ctx, existing);
                const updated = await this.allocateExistingDelivery(ctx, existing);
                deliveries.push(updated);
                const staleDispatch =
                    !existing.lastDispatchedAt ||
                    Date.now() - existing.lastDispatchedAt.getTime() > 15 * 60_000;
                if (['ALLOCATED', 'RETRYING'].includes(updated.state) && staleDispatch) {
                    await this.dispatch(ctx, updated, 'EMAIL_QUEUED', '重用已分配卡密继续发送');
                }
                continue;
            }
            const config = source?.config;
            if (!config) {
                throw new Error(`SKU ${line.productVariant.sku} 未配置自动发卡`);
            }
            let delivery: AutoCardDelivery;
            try {
                delivery = await this.createAndAllocate(
                    ctx,
                    order,
                    line,
                    config,
                    recipientEmail,
                    source?.snapshot ?? null,
                );
            } catch (error) {
                const concurrentDelivery = await this.connection
                    .getRepository(ctx, AutoCardDelivery)
                    .findOne({
                        where: { orderLineId: line.id },
                        relations: { poolItems: true, config: true, order: true },
                    });
                if (!concurrentDelivery) {
                    throw error;
                }
                this.assertDeliveryScope(ctx, concurrentDelivery);
                delivery = concurrentDelivery;
            }
            deliveries.push(delivery);
            if (delivery.state === 'ALLOCATED') {
                await this.dispatch(ctx, delivery, 'EMAIL_QUEUED', '卡密已进入邮件发送队列');
            }
        }
        return deliveries;
    }

    async notificationPayload(ctx: RequestContext, id: ID) {
        const delivery = await this.deliveryOrThrow(ctx, id);
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

    async emailPayload(ctx: RequestContext, deliveryId: ID): Promise<AutoCardEmailPayload> {
        const delivery = await this.deliveryOrThrow(ctx, deliveryId);
        const eligible = digitalDeliverableQuantity(delivery.order, delivery.orderLine);
        if (!eligible) throw new UserInputError('该订单商品尚未付款、已取消或正在退款，不能继续交付');
        if (!delivery.poolItems.some(item => item.state === 'ASSIGNED'))
            throw new Error('当前发卡记录尚未分配卡密');
        const fields = parseAutoCardFieldsJson(delivery.schemaSnapshot);
        const isChinese = delivery.languageCode === 'zh_Hans';
        return {
            deliveryId: String(delivery.id),
            recipientEmail: delivery.order.customFields?.deliveryEmail?.trim() || delivery.recipientEmail,
            orderCode: delivery.order.code,
            productName: delivery.productName,
            sku: delivery.sku,
            isChinese,
            instructions: delivery.instructionsSnapshot,
            credentials: delivery.poolItems
                .filter(item => item.state === 'ASSIGNED')
                .slice()
                .sort((left, right) => left.sequence - right.sequence)
                .slice(0, eligible)
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
        return this.connection.withTransaction(ctx, tx =>
            this.recordEmailResultInTransaction(tx, deliveryId, success, error),
        );
    }

    private async recordEmailResultInTransaction(
        ctx: RequestContext,
        deliveryId: ID,
        success: boolean,
        error?: Error,
    ): Promise<void> {
        const delivery = await this.lockDeliveryOrThrow(ctx, deliveryId);
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
            await this.persistDeliveryState(ctx, delivery);
            await this.addEvent(ctx, delivery, 'EMAIL_SENT', '自动发卡邮件已发送');
            if (wasManualReview) await this.resolveDeliveryFailure(ctx, delivery);
            await this.completeFulfillment(ctx, delivery);
            return;
        }
        delivery.lastError = String(error?.message ?? '邮件发送失败').slice(0, 2_000);
        delivery.state = delivery.attemptCount >= MAX_EMAIL_ATTEMPTS ? 'MANUAL_REVIEW' : 'RETRYING';
        await this.persistDeliveryState(ctx, delivery);
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
            await this.persistDeliveryState(ctx, delivery);
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
                order: { payments: { refunds: { lines: true } } },
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
                await this.connection.withTransaction(ctx, async tx => {
                    let delivery = await this.lockDeliveryOrThrow(tx, item.id);
                    if (delivery.order.state === 'Cancelled') return;
                    if (delivery.state === 'SENT' && !delivery.fulfillmentId) {
                        await this.completeFulfillment(tx, delivery);
                        completedFulfillments++;
                        return;
                    }
                    if (delivery.state === 'WAITING_STOCK') {
                        delivery = await this.allocateExistingDelivery(tx, delivery);
                        if (delivery.state === 'ALLOCATED') allocated++;
                    }
                    const stale =
                        !delivery.lastDispatchedAt ||
                        Date.now() - delivery.lastDispatchedAt.getTime() > 15 * 60_000;
                    if (['ALLOCATED', 'RETRYING'].includes(delivery.state) && stale) {
                        await this.dispatch(tx, delivery, 'EMAIL_QUEUED', '定时检查重新投递发卡邮件');
                        redispatched++;
                    }
                });
            } catch (error) {
                Logger.error(error instanceof Error ? error.message : String(error), loggerCtx);
            }
        }
        return { allocated, redispatched, completedFulfillments };
    }

    private async publishSupplyStockChange(ctx: RequestContext, configId: ID, variantId: ID) {
        const grants = await this.connection
            .getRepository(ctx, AutoCardSupplyGrant)
            .find({ where: { configId, enabled: true } });
        await this.eventBus.publish(
            new StorefrontDataChangedEvent(ctx, ['catalog'], {
                channelIds: [
                    (
                        await this.connection
                            .getRepository(ctx, AutoCardConfig)
                            .findOneOrFail({ where: { id: configId } })
                    ).channelId,
                    ...grants.map(g => g.channelId),
                ],
                entityType: 'ProductVariant',
                entityIds: [variantId],
            }),
        );
    }

    private async reconcileVariant(ctx: RequestContext, productVariantId: ID): Promise<void> {
        const waiting = await this.connection.getRepository(ctx, AutoCardDelivery).find({
            where: {
                state: 'WAITING_STOCK',
                config: { channelId: ctx.channelId, productVariantId },
            },
            relations: {
                channel: true,
                config: true,
                order: { payments: { refunds: { lines: true } } },
                orderLine: { productVariant: true },
                poolItems: true,
            },
            order: { createdAt: 'ASC' },
            take: 100,
        });
        for (const delivery of waiting) {
            const salesCtx = ctx.copy({
                channel: delivery.channel,
                currencyCode: delivery.channel.defaultCurrencyCode,
            });
            const allocated = await this.allocateExistingDelivery(salesCtx, delivery);
            if (allocated.state === 'ALLOCATED') {
                await this.dispatch(salesCtx, allocated, 'EMAIL_QUEUED', '补货后自动恢复发卡');
            }
        }
    }

    private async createAndAllocate(
        ctx: RequestContext,
        order: Order,
        line: OrderLine,
        config: AutoCardConfig,
        recipientEmail: string,
        supplySnapshot: AutoCardSupplySnapshot | null = null,
    ): Promise<AutoCardDelivery> {
        const delivery = await this.connection.getRepository(ctx, AutoCardDelivery).save(
            new AutoCardDelivery({
                state: 'WAITING_STOCK',
                sourceChannelId: config.channelId,
                supplyGrantId: supplySnapshot?.grantId ?? null,
                supplyGrantVersion: supplySnapshot?.grantVersion ?? null,
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
        const delivery = await this.lockDeliveryOrThrow(ctx, input.id);
        const eligible = digitalDeliverableQuantity(delivery.order, delivery.orderLine);
        const remainingQuantity = Math.max(0, eligible - delivery.poolItems.length);
        if (!remainingQuantity) {
            delivery.quantity = delivery.poolItems.length;
            if (eligible && delivery.state !== 'SENT') delivery.state = 'ALLOCATED';
            return this.persistDeliveryState(ctx, delivery);
        }
        const reservation = await this.digitalProducts.reservation(ctx, delivery.orderLineId);
        const repository = this.connection.getRepository(ctx, AutoCardPoolItem);
        let candidates: AutoCardPoolItem[];
        if (reservation?.state === 'HELD' && reservation.stockPolicy === 'pool_derived') {
            const reservedIds = JSON.parse(reservation.poolItemIdsJson) as ID[];
            candidates = reservedIds.length
                ? await repository.find({
                      where: { id: In(reservedIds), state: 'RESERVED' },
                      order: { sequence: 'ASC' },
                      take: remainingQuantity,
                  })
                : [];
        } else
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
            await this.persistDeliveryState(ctx, delivery);
            if (!delivery.events.some(event => event.type === 'WAITING_STOCK')) {
                await this.addEvent(ctx, delivery, 'WAITING_STOCK', delivery.lastError);
            }
            await this.publishStockShortage(ctx, delivery, candidates.length, remainingQuantity);
            return delivery;
        }
        candidates = candidates.slice(0, remainingQuantity);
        const ids = candidates.map(item => item.id);
        const update = await repository
            .createQueryBuilder()
            .update(AutoCardPoolItem)
            .set({ state: 'ASSIGNED', assignedAt: new Date(), deliveryId: delivery.id })
            .whereInIds(ids)
            .andWhere('state = :available', {
                available: reservation?.state === 'HELD' ? 'RESERVED' : 'AVAILABLE',
            })
            .execute();
        if (update.affected !== remainingQuantity) {
            delivery.state = 'WAITING_STOCK';
            delivery.lastError = '号池发生并发分配，系统将自动重试';
            await this.persistDeliveryState(ctx, delivery);
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
        await this.persistDeliveryState(ctx, delivery);
        delivery.quantity = delivery.poolItems.length;
        await this.persistDeliveryState(ctx, delivery);
        await this.digitalProducts.consumeLine(ctx, delivery.orderLineId, remainingQuantity);
        await this.addEvent(ctx, delivery, 'ALLOCATED', `已按号池顺序分配 ${delivery.quantity} 份卡密`);
        await this.publishSupplyStockChange(ctx, delivery.configId, delivery.config.productVariantId);
        if (wasWaitingForStock) await this.resolveStockShortage(ctx, delivery);
        return delivery;
    }

    private async persistDeliveryState(
        ctx: RequestContext,
        delivery: AutoCardDelivery,
    ): Promise<AutoCardDelivery> {
        const repository = this.connection.getRepository(ctx, AutoCardDelivery);
        if (!['mysql', 'mariadb'].includes(this.connection.rawConnection.options.type)) {
            return repository.save(delivery);
        }
        // save() checks existence with a snapshot read and can insert a row acquired by a current lock.
        // The locked delivery already exists; update its mutable columns without reconciling relations.
        await repository.update(
            { id: delivery.id, channelId: ctx.channelId },
            {
                state: delivery.state,
                quantity: delivery.quantity,
                attemptCount: delivery.attemptCount,
                lastError: delivery.lastError,
                lastDispatchedAt: delivery.lastDispatchedAt,
                sentAt: delivery.sentAt,
                fulfillmentId: delivery.fulfillmentId,
            },
        );
        return delivery;
    }

    private async dispatch(
        ctx: RequestContext,
        delivery: AutoCardDelivery,
        eventType: AutoCardDeliveryEventType,
        note: string,
    ): Promise<void> {
        this.assertDeliveryScope(ctx, delivery);
        delivery.lastDispatchedAt = new Date();
        await this.persistDeliveryState(ctx, delivery);
        await this.addEvent(ctx, delivery, eventType, note);
        await this.eventBus.publish(
            new AutoCardDeliveryReadyEvent(
                ctx.copy({ languageCode: delivery.languageCode as LanguageCode }),
                String(delivery.id),
            ),
        );
    }

    async completeAvailableDeliveries(ctx: RequestContext, orderId: ID): Promise<void> {
        const deliveries = await this.connection.getRepository(ctx, AutoCardDelivery).find({
            where: {
                channelId: ctx.channelId,
                orderId,
                state: In(['ALLOCATED', 'RETRYING', 'SENT']),
            },
        });
        for (const delivery of deliveries) {
            await this.digitalProducts.lock(ctx, AutoCardDelivery, delivery.id);
            const current = await this.deliveryOrThrow(ctx, delivery.id);
            if (digitalDeliverableQuantity(current.order, current.orderLine))
                await this.completeFulfillment(ctx, current);
        }
    }

    private async completeFulfillment(ctx: RequestContext, delivery: AutoCardDelivery): Promise<void> {
        this.assertDeliveryScope(ctx, delivery);
        const history = await this.connection
            .getRepository(ctx, FulfillmentLine)
            .find({ where: { orderLineId: delivery.orderLineId }, relations: ['fulfillment'] });
        const fulfilled = history
            .filter(item => item.fulfillment.state !== 'Cancelled')
            .reduce((sum, item) => sum + item.quantity, 0);
        const quantity = Math.max(
            0,
            Math.min(
                delivery.poolItems.length,
                digitalDeliverableQuantity(delivery.order, delivery.orderLine),
            ) - fulfilled,
        );
        if (!quantity) return;
        const result = await this.orderService.createFulfillment(ctx, {
            lines: [{ orderLineId: delivery.orderLineId, quantity }],
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
        await this.persistDeliveryState(ctx, delivery);

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

    private async deliveryOrThrow(
        ctx: RequestContext,
        id: ID,
        currentRead = false,
    ): Promise<AutoCardDelivery> {
        const delivery = await this.connection.getRepository(ctx, AutoCardDelivery).findOne({
            where: { id, channelId: ctx.channelId },
            relations: {
                config: true,
                channel: true,
                order: { payments: { refunds: { lines: true } } },
                orderLine: { productVariant: true },
                poolItems: true,
                events: true,
            },
            order: { events: { createdAt: 'ASC' } },
            ...(currentRead
                ? { lock: { mode: 'pessimistic_write' as const }, relationLoadStrategy: 'join' as const }
                : {}),
        });
        if (!delivery) throw new UserInputError('发卡记录不存在');
        this.assertDeliveryScope(ctx, delivery);
        return delivery;
    }

    private assertDeliveryScope(ctx: RequestContext, delivery: AutoCardDelivery): void {
        if (
            !delivery.order ||
            String(delivery.order.id) !== String(delivery.orderId) ||
            String(delivery.channelId) !== String(ctx.channelId) ||
            !delivery.config ||
            (String(delivery.config.channelId) !== String(ctx.channelId) &&
                (!delivery.supplyGrantId ||
                    !delivery.supplyGrantVersion ||
                    String(delivery.sourceChannelId) !== String(delivery.config.channelId)))
        ) {
            throw new UserInputError('发卡任务归属不一致，请核查');
        }
        assertOrderSalesChannel(ctx, delivery.order);
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
        // Hydration must also use a current read after the row lock under MySQL REPEATABLE READ.
        return this.deliveryOrThrow(
            ctx,
            id,
            ['mysql', 'mariadb'].includes(this.connection.rawConnection.options.type),
        );
    }

    private async addEvent(
        ctx: RequestContext,
        delivery: AutoCardDelivery,
        type: AutoCardDeliveryEventType,
        note: string,
        actorType: 'SYSTEM' | 'ADMIN' = 'SYSTEM',
    ): Promise<AutoCardDeliveryEvent> {
        const saved = await this.connection.getRepository(ctx, AutoCardDeliveryEvent).save(
            new AutoCardDeliveryEvent({
                delivery,
                deliveryId: delivery.id,
                type,
                actorType,
                actorId: actorType === 'ADMIN' ? String(ctx.activeUserId ?? '') : null,
                note: note.slice(0, 2_000),
            }),
        );
        await this.eventBus.publish(new OrderProcessingChangedEvent(ctx, String(delivery.orderId)));
        return saved;
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
