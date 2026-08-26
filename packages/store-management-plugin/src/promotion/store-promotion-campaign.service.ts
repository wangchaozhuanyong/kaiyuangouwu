import { Injectable } from '@nestjs/common';
import {
    ConfigurableOperationInput,
    CreatePromotionInput,
    LanguageCode,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import type { ProductVariant } from '@vendure/core';
import {
    Collection,
    CustomerService,
    idsAreEqual,
    isGraphQlErrorResult,
    ProductVariantService,
    Promotion,
    PromotionService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { In } from 'typeorm';

import { CouponOrderAllocation } from '../entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';
import {
    CreateStoreCouponCampaignInput,
    CreateStoreFlashSaleInput,
    StoreCouponCampaignKind,
    StoreCouponCampaignView,
    StoreFlashSaleItemView,
    StoreFlashSaleView,
} from '../types';

import { idListArg, numberArg, stringArg } from './promotion-operation-args';
import { parseFlashSaleVariantRules } from './store-commerce-promotion-actions';

@Injectable()
export class StorePromotionCampaignService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly promotionService: PromotionService,
        private readonly productVariantService: ProductVariantService,
        private readonly customerService: CustomerService,
    ) {}

    async findCoupons(ctx: RequestContext): Promise<StoreCouponCampaignView[]> {
        const promotions = await this.findPromotions(ctx);
        const couponPromotions = promotions.flatMap(promotion => {
            const view = this.toCouponView(promotion);
            return view ? [{ promotion, view }] : [];
        });
        if (!couponPromotions.length) return [];

        const promotionIds = couponPromotions.map(({ promotion }) => promotion.id);
        const [configs, statusRows, allocationRows, activeCustomer] = await Promise.all([
            this.connection.getRepository(ctx, StoreCouponCampaignConfig).find({
                where: { channelId: ctx.channelId, promotionId: In(promotionIds) },
            }),
            this.couponStatusRows(ctx, promotionIds),
            this.couponAllocationRows(ctx, promotionIds),
            ctx.activeUserId ? this.customerService.findOneByUserId(ctx, ctx.activeUserId) : undefined,
        ]);
        const customerRows = activeCustomer
            ? await this.connection
                  .getRepository(ctx, CustomerCoupon)
                  .createQueryBuilder('coupon')
                  .select('coupon.promotionId', 'promotionId')
                  .addSelect('COUNT(coupon.id)', 'count')
                  .where('coupon.channelId = :channelId', { channelId: ctx.channelId })
                  .andWhere('coupon.customerId = :customerId', { customerId: activeCustomer.id })
                  .andWhere('coupon.promotionId IN (:...promotionIds)', { promotionIds })
                  .groupBy('coupon.promotionId')
                  .getRawMany<{ promotionId: string; count: string }>()
            : [];
        const configsByPromotion = new Map(configs.map(config => [String(config.promotionId), config]));
        const customerCounts = new Map(customerRows.map(row => [String(row.promotionId), Number(row.count)]));
        const statsByPromotion = this.campaignStats(statusRows, allocationRows);

        return couponPromotions.map(({ promotion, view }) => {
            const config = configsByPromotion.get(String(promotion.id));
            const stats = statsByPromotion.get(String(promotion.id)) ?? emptyCampaignStats();
            const issueLimit = config?.issueLimit ?? promotion.usageLimit ?? null;
            const remainingIssueCount =
                issueLimit == null ? null : Math.max(0, issueLimit - stats.claimedCount);
            const perCustomerClaimLimit = config?.perCustomerClaimLimit ?? 1;
            const customerClaimedCount = customerCounts.get(String(promotion.id)) ?? 0;
            return {
                ...view,
                ...stats,
                claimStartsAt: config?.claimStartsAt ?? promotion.startsAt,
                claimEndsAt: config?.claimEndsAt ?? promotion.endsAt,
                validityDays: config?.validityDays ?? null,
                issueLimit,
                perCustomerClaimLimit,
                stackPolicy: config?.stackPolicy ?? 'EXCLUSIVE',
                returnOnCancellation: config?.returnOnCancellation ?? true,
                returnOnFullRefund: config?.returnOnFullRefund ?? true,
                remainingIssueCount,
                claimed: customerClaimedCount > 0,
                claimable:
                    customerClaimedCount < perCustomerClaimLimit &&
                    (remainingIssueCount == null || remainingIssueCount > 0),
            };
        });
    }

    async findActiveCoupons(ctx: RequestContext): Promise<StoreCouponCampaignView[]> {
        const now = new Date();
        return (await this.findCoupons(ctx))
            .filter(
                coupon =>
                    coupon.enabled &&
                    (!coupon.startsAt || coupon.startsAt <= now) &&
                    (!coupon.endsAt || coupon.endsAt > now) &&
                    (!coupon.claimStartsAt || coupon.claimStartsAt <= now) &&
                    (!coupon.claimEndsAt || coupon.claimEndsAt > now) &&
                    (coupon.claimed || coupon.remainingIssueCount == null || coupon.remainingIssueCount > 0),
            )
            .slice(0, 50);
    }

    async createCoupon(
        ctx: RequestContext,
        input: CreateStoreCouponCampaignInput,
    ): Promise<StoreCouponCampaignView> {
        const normalized = await this.normalizeCouponInput(ctx, input);
        const result = await this.promotionService.createPromotion(ctx, normalized);
        if (isGraphQlErrorResult(result)) {
            throw new UserInputError(result.message);
        }
        const view = this.toCouponView(result);
        if (!view) {
            throw new UserInputError('优惠券创建后无法识别，请检查优惠动作配置');
        }
        const config = await this.connection.getRepository(ctx, StoreCouponCampaignConfig).save(
            new StoreCouponCampaignConfig({
                channelId: ctx.channelId,
                promotionId: result.id,
                claimStartsAt: input.claimStartsAt
                    ? this.validDate(input.claimStartsAt, '领取开始时间')
                    : (result.startsAt ?? null),
                claimEndsAt: input.claimEndsAt
                    ? this.validDate(input.claimEndsAt, '领取结束时间')
                    : (result.endsAt ?? null),
                validityDays: this.optionalPositiveInteger(input.validityDays, '领取后有效天数'),
                issueLimit:
                    this.optionalPositiveInteger(input.issueLimit, '发放数量') ?? result.usageLimit ?? null,
                perCustomerClaimLimit:
                    this.optionalPositiveInteger(input.perCustomerClaimLimit, '每位客户领取次数') ?? 1,
                stackPolicy: input.stackPolicy ?? 'EXCLUSIVE',
                returnOnCancellation: input.returnOnCancellation ?? true,
                returnOnFullRefund: input.returnOnFullRefund ?? true,
            }),
        );
        if (config.claimStartsAt && config.claimEndsAt && config.claimStartsAt >= config.claimEndsAt) {
            throw new UserInputError('领取结束时间必须晚于领取开始时间');
        }
        return {
            ...view,
            ...emptyCampaignStats(),
            claimStartsAt: config.claimStartsAt,
            claimEndsAt: config.claimEndsAt,
            validityDays: config.validityDays,
            issueLimit: config.issueLimit,
            perCustomerClaimLimit: config.perCustomerClaimLimit,
            stackPolicy: config.stackPolicy,
            returnOnCancellation: config.returnOnCancellation,
            returnOnFullRefund: config.returnOnFullRefund,
            remainingIssueCount: config.issueLimit,
            claimed: false,
            claimable: true,
        };
    }

    async findFlashSales(ctx: RequestContext, activeOnly = false): Promise<StoreFlashSaleView[]> {
        const now = new Date();
        const promotions = (await this.findPromotions(ctx))
            .filter(
                promotion =>
                    promotion.actions.some(action => action.code === 'store_flash_sale_price') &&
                    (!activeOnly ||
                        (promotion.enabled &&
                            (!promotion.startsAt || promotion.startsAt <= now) &&
                            (!promotion.endsAt || promotion.endsAt > now))),
            )
            .slice(0, activeOnly ? 10 : 1_000);
        return Promise.all(
            promotions.map(promotion => this.toFlashSaleView(ctx, promotion, activeOnly ? 100 : 1_000)),
        );
    }

    async createFlashSale(
        ctx: RequestContext,
        input: CreateStoreFlashSaleInput,
    ): Promise<StoreFlashSaleView> {
        const name = this.requiredText(input.name, '秒杀活动名称', 120);
        const startsAt = this.validDate(input.startsAt, '开始时间');
        const endsAt = this.validDate(input.endsAt, '结束时间');
        if (startsAt >= endsAt) {
            throw new UserInputError('秒杀结束时间必须晚于开始时间');
        }
        if (!Number.isFinite(input.percentageOff) || input.percentageOff < 0 || input.percentageOff >= 100) {
            throw new UserInputError('批量降价比例必须在 0 到 100 之间');
        }
        if (uniqueIds(input.productIds).length > 50) {
            throw new UserInputError('一个秒杀活动最多选择 50 个商品');
        }
        const variants = await this.variantsForProducts(ctx, input.productIds);
        if (!variants.length) {
            throw new UserInputError('至少选择一个有可售规格的商品');
        }
        const overrides = new Map(
            (input.variantPrices ?? []).map(item => [String(item.productVariantId), item.salePrice]),
        );
        const variantIds = variants.map(variant => String(variant.id));
        if ([...overrides.keys()].some(variantId => !variantIds.includes(variantId))) {
            throw new UserInputError('单独设置价格的规格必须属于已选商品');
        }
        const variantRules = variants.map(variant => {
            const salePrice = overrides.get(String(variant.id));
            if (salePrice != null) {
                if (!Number.isInteger(salePrice) || salePrice < 0) {
                    throw new UserInputError('单独设置的秒杀价格必须是大于或等于 0 的金额');
                }
                if (salePrice >= variant.priceWithTax) {
                    throw new UserInputError(`规格“${variant.name}”的秒杀价必须低于原价`);
                }
                return { variantId: String(variant.id), salePrice };
            }
            if (input.percentageOff <= 0) {
                throw new UserInputError('未设置单独秒杀价的规格，批量降价比例必须大于 0');
            }
            return { variantId: String(variant.id), percentageOff: input.percentageOff };
        });
        await this.assertNoOverlappingFlashSale(ctx, variantIds, startsAt, endsAt);
        const result = await this.promotionService.createPromotion(ctx, {
            enabled: true,
            startsAt,
            endsAt,
            couponCode: undefined,
            conditions: [
                operation('contains_products', {
                    minimum: 1,
                    productVariantIds: variants.map(variant => String(variant.id)),
                }),
            ],
            actions: [operation('store_flash_sale_price', { variantRules: JSON.stringify(variantRules) })],
            translations: promotionTranslations(ctx, name, '限时秒杀活动'),
        });
        if (isGraphQlErrorResult(result)) {
            throw new UserInputError(result.message);
        }
        return this.toFlashSaleView(ctx, result);
    }

    async setEnabled(ctx: RequestContext, id: ID, enabled: boolean): Promise<Promotion> {
        if (enabled) {
            const promotion = await this.promotionService.findOne(ctx, id);
            if (!promotion) throw new UserInputError('找不到该促销活动');
            const flashAction = promotion.actions.find(action => action.code === 'store_flash_sale_price');
            if (flashAction) {
                await this.assertNoOverlappingFlashSale(
                    ctx,
                    parseFlashSaleVariantRules(stringArg(flashAction, 'variantRules')).map(
                        rule => rule.variantId,
                    ),
                    promotion.startsAt,
                    promotion.endsAt,
                    promotion.id,
                );
            }
        }
        const result = await this.promotionService.updatePromotion(ctx, { id, enabled });
        if (isGraphQlErrorResult(result)) {
            throw new UserInputError(result.message);
        }
        return result;
    }

    delete(ctx: RequestContext, id: ID) {
        return this.promotionService.softDeletePromotion(ctx, id);
    }

    private async normalizeCouponInput(
        ctx: RequestContext,
        input: CreateStoreCouponCampaignInput,
    ): Promise<CreatePromotionInput> {
        const name = this.requiredText(input.name, '优惠券名称', 120);
        const couponCode = createInternalCouponCode();
        const minimumSpend = input.minimumSpend ?? 0;
        if (!Number.isInteger(minimumSpend) || minimumSpend < 0) {
            throw new UserInputError('最低消费金额必须是大于或等于 0 的金额');
        }
        const conditions = [operation('store_customer_coupon_entitlement', {})];
        if (minimumSpend) {
            conditions.push(operation('minimum_order_amount', { amount: minimumSpend, taxInclusive: true }));
        }
        const actions: ConfigurableOperationInput[] = [];
        if (input.kind === 'ORDER_FIXED') {
            const amount = input.discountAmount ?? 0;
            if (!Number.isInteger(amount) || amount <= 0) {
                throw new UserInputError('满减券的减免金额必须大于 0');
            }
            actions.push(operation('order_fixed_discount', { discount: amount }));
        } else {
            const percentageOff = discountRateToPercentageOff(input.discountRate);
            if (input.kind === 'ORDER_PERCENTAGE') {
                actions.push(operation('order_percentage_discount', { discount: percentageOff }));
            } else if (input.kind === 'COLLECTION_PERCENTAGE') {
                const collectionIds = uniqueIds(input.collectionIds ?? []);
                const collections = await this.connection.findByIdsInChannel(
                    ctx,
                    Collection,
                    collectionIds,
                    ctx.channelId,
                    {},
                );
                if (!collectionIds.length || collections.length !== collectionIds.length) {
                    throw new UserInputError('请选择当前店铺中的有效商品分类');
                }
                actions.push(
                    operation('store_collection_percentage_discount', {
                        discount: percentageOff,
                        collectionIds,
                    }),
                );
            } else if (input.kind === 'PRODUCT_PERCENTAGE') {
                if (uniqueIds(input.productIds ?? []).length > 100) {
                    throw new UserInputError('一张单品折扣券最多适用 100 个商品');
                }
                const variants = await this.variantsForProducts(ctx, input.productIds ?? []);
                if (!variants.length) {
                    throw new UserInputError('请选择至少一个有可售规格的商品');
                }
                actions.push(
                    operation('products_percentage_discount', {
                        discount: percentageOff,
                        productVariantIds: variants.map(variant => String(variant.id)),
                    }),
                );
            } else {
                throw new UserInputError('不支持的优惠券类型');
            }
        }
        const startsAt = input.startsAt ? this.validDate(input.startsAt, '开始时间') : null;
        const endsAt = input.endsAt ? this.validDate(input.endsAt, '结束时间') : null;
        if (startsAt && endsAt && startsAt >= endsAt) {
            throw new UserInputError('优惠券结束时间必须晚于开始时间');
        }
        return {
            enabled: true,
            startsAt,
            endsAt,
            couponCode,
            usageLimit: this.optionalPositiveInteger(input.usageLimit, '总使用次数') ?? undefined,
            perCustomerUsageLimit:
                this.optionalPositiveInteger(input.perCustomerUsageLimit, '每位客户使用次数') ?? undefined,
            conditions,
            actions,
            translations: promotionTranslations(ctx, name, '店铺优惠券'),
        };
    }

    private toCouponView(promotion: Promotion): StoreCouponCampaignView | null {
        if (!promotion.couponCode) return null;
        const action = promotion.actions.find(candidate => couponKindForAction(candidate.code));
        const kind = action ? couponKindForAction(action.code) : null;
        if (!action || !kind) return null;
        const minimumCondition = promotion.conditions.find(
            condition => condition.code === 'minimum_order_amount',
        );
        const percentageOff = numberArg(action, 'discount');
        return {
            id: promotion.id,
            name: promotion.name,
            couponCode: promotion.couponCode,
            kind,
            enabled: promotion.enabled,
            startsAt: promotion.startsAt,
            endsAt: promotion.endsAt,
            minimumSpend: numberArg(minimumCondition, 'amount'),
            discountAmount: kind === 'ORDER_FIXED' ? numberArg(action, 'discount') : null,
            discountRate: kind === 'ORDER_FIXED' ? null : percentageOffToDiscountRate(percentageOff),
            collectionIds: idListArg(action, 'collectionIds'),
            productVariantIds: idListArg(action, 'productVariantIds'),
            usageLimit: promotion.usageLimit,
            perCustomerUsageLimit: promotion.perCustomerUsageLimit,
            ...emptyCampaignStats(),
            claimStartsAt: promotion.startsAt,
            claimEndsAt: promotion.endsAt,
            validityDays: null,
            issueLimit: promotion.usageLimit,
            perCustomerClaimLimit: 1,
            stackPolicy: 'EXCLUSIVE',
            returnOnCancellation: true,
            returnOnFullRefund: true,
            remainingIssueCount: promotion.usageLimit,
            claimed: false,
            claimable: true,
        };
    }

    private couponStatusRows(ctx: RequestContext, promotionIds: ID[]) {
        return this.connection
            .getRepository(ctx, CustomerCoupon)
            .createQueryBuilder('coupon')
            .select('coupon.promotionId', 'promotionId')
            .addSelect('coupon.status', 'status')
            .addSelect('COUNT(coupon.id)', 'count')
            .where('coupon.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('coupon.promotionId IN (:...promotionIds)', { promotionIds })
            .groupBy('coupon.promotionId')
            .addGroupBy('coupon.status')
            .getRawMany<{ promotionId: string; status: string; count: string }>();
    }

    private couponAllocationRows(ctx: RequestContext, promotionIds: ID[]) {
        return this.connection
            .getRepository(ctx, CouponOrderAllocation)
            .createQueryBuilder('allocation')
            .select('allocation.promotionId', 'promotionId')
            .addSelect('COUNT(allocation.id)', 'redeemedOrderCount')
            .addSelect(
                `SUM(CASE WHEN allocation.status = 'REFUNDED' THEN 1 ELSE 0 END)`,
                'refundedOrderCount',
            )
            .addSelect('COALESCE(SUM(allocation.discountAmountWithTax), 0)', 'discountAmountTotal')
            .addSelect('COALESCE(SUM(allocation.orderTotalWithTax), 0)', 'assistedRevenueTotal')
            .where('allocation.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('allocation.promotionId IN (:...promotionIds)', { promotionIds })
            .andWhere("allocation.status IN ('USED', 'REFUNDED')")
            .groupBy('allocation.promotionId')
            .getRawMany<{
                promotionId: string;
                redeemedOrderCount: string;
                refundedOrderCount: string;
                discountAmountTotal: string;
                assistedRevenueTotal: string;
            }>();
    }

    private campaignStats(
        statusRows: Array<{ promotionId: string; status: string; count: string }>,
        allocationRows: Array<{
            promotionId: string;
            redeemedOrderCount: string;
            refundedOrderCount: string;
            discountAmountTotal: string;
            assistedRevenueTotal: string;
        }>,
    ) {
        const result = new Map<string, ReturnType<typeof emptyCampaignStats>>();
        for (const row of statusRows) {
            const stats = result.get(String(row.promotionId)) ?? emptyCampaignStats();
            const count = Number(row.count);
            stats.claimedCount += count;
            if (row.status === 'AVAILABLE') stats.availableCount += count;
            if (row.status === 'LOCKED') stats.lockedCount += count;
            if (row.status === 'USED') stats.usedCount += count;
            if (row.status === 'RETURNED') stats.returnedCount += count;
            if (row.status === 'EXPIRED') stats.expiredCount += count;
            if (row.status === 'REVOKED') stats.revokedCount += count;
            result.set(String(row.promotionId), stats);
        }
        for (const row of allocationRows) {
            const stats = result.get(String(row.promotionId)) ?? emptyCampaignStats();
            stats.redeemedOrderCount = Number(row.redeemedOrderCount);
            stats.refundedOrderCount = Number(row.refundedOrderCount);
            stats.discountAmountTotal = Number(row.discountAmountTotal);
            stats.assistedRevenueTotal = Number(row.assistedRevenueTotal);
            result.set(String(row.promotionId), stats);
        }
        return result;
    }

    private async toFlashSaleView(
        ctx: RequestContext,
        promotion: Promotion,
        itemLimit = 1_000,
    ): Promise<StoreFlashSaleView> {
        const action = promotion.actions.find(candidate => candidate.code === 'store_flash_sale_price');
        const rules = parseFlashSaleVariantRules(stringArg(action, 'variantRules'));
        const mappedItems: Array<StoreFlashSaleItemView | null> = await Promise.all(
            rules.slice(0, itemLimit).map(async rule => {
                const variant = await this.productVariantService.findOne(ctx, rule.variantId);
                if (!variant) return null;
                const originalPrice = variant.priceWithTax;
                const salePrice =
                    rule.salePrice ??
                    Math.round(originalPrice * (1 - Math.min(100, rule.percentageOff ?? 0) / 100));
                return {
                    productId: String(variant.product.id),
                    productVariantId: String(variant.id),
                    productName: String(variant.product.name),
                    variantName: String(variant.name),
                    originalPrice,
                    salePrice,
                    currencyCode: variant.currencyCode,
                    imageUrl:
                        variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview ?? null,
                };
            }),
        );
        const items = mappedItems.filter((item): item is StoreFlashSaleItemView => item != null);
        return {
            id: promotion.id,
            name: promotion.name,
            enabled: promotion.enabled,
            startsAt: promotion.startsAt,
            endsAt: promotion.endsAt,
            items,
        };
    }

    private findPromotions(ctx: RequestContext): Promise<Promotion[]> {
        return this.loadPromotions(ctx);
    }

    private async variantsForProducts(ctx: RequestContext, productIds: ID[]) {
        const uniqueProductIds = uniqueIds(productIds);
        const variants = await Promise.all(
            uniqueProductIds.map(productId => this.loadProductVariants(ctx, productId)),
        );
        return variants.flat();
    }

    private async loadPromotions(ctx: RequestContext): Promise<Promotion[]> {
        const items: Promotion[] = [];
        while (true) {
            const page = await this.promotionService.findAll(ctx, { take: 100, skip: items.length });
            items.push(...page.items);
            if (items.length >= page.totalItems || page.items.length === 0) return items;
        }
    }

    private async loadProductVariants(ctx: RequestContext, productId: ID): Promise<ProductVariant[]> {
        const items: ProductVariant[] = [];
        while (true) {
            const page = await this.productVariantService.getVariantsByProductId(ctx, productId, {
                take: 100,
                skip: items.length,
            });
            items.push(...page.items);
            if (items.length >= page.totalItems || page.items.length === 0) return items;
        }
    }

    private async assertNoOverlappingFlashSale(
        ctx: RequestContext,
        variantIds: ID[],
        startsAt: Date | null,
        endsAt: Date | null,
        excludePromotionId?: ID,
    ): Promise<void> {
        const requestedIds = new Set(variantIds.map(String));
        const overlappingPromotion = (await this.findPromotions(ctx)).find(promotion => {
            if (!promotion.enabled || idsAreEqual(promotion.id, excludePromotionId)) return false;
            const action = promotion.actions.find(candidate => candidate.code === 'store_flash_sale_price');
            if (!action) return false;
            const sharesVariant = parseFlashSaleVariantRules(stringArg(action, 'variantRules')).some(rule =>
                requestedIds.has(String(rule.variantId)),
            );
            return sharesVariant && dateRangesOverlap(startsAt, endsAt, promotion.startsAt, promotion.endsAt);
        });
        if (overlappingPromotion) {
            throw new UserInputError(
                `已选商品与秒杀活动“${overlappingPromotion.name}”的时间重叠，请调整时间或商品`,
            );
        }
    }

    private requiredText(value: string, label: string, maxLength: number): string {
        const normalized = value?.trim();
        if (!normalized) throw new UserInputError(`${label}不能为空`);
        if (normalized.length > maxLength) throw new UserInputError(`${label}不能超过 ${maxLength} 个字符`);
        return normalized;
    }

    private validDate(value: Date, label: string): Date {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new UserInputError(`${label}格式不正确`);
        return date;
    }

    private optionalPositiveInteger(value: number | null | undefined, label: string): number | null {
        if (value == null) return null;
        if (!Number.isInteger(value) || value <= 0) throw new UserInputError(`${label}必须是大于 0 的整数`);
        return value;
    }
}

function createInternalCouponCode(): string {
    return `CPN_${randomUUID().replace(/-/g, '').toUpperCase()}`;
}

function operation(
    code: string,
    args: Record<string, string | number | boolean | string[]>,
): ConfigurableOperationInput {
    return {
        code,
        arguments: Object.entries(args).map(([name, value]) => ({
            name,
            value: Array.isArray(value) ? JSON.stringify(value) : String(value),
        })),
    };
}

function promotionTranslations(_ctx: RequestContext, name: string, description: string) {
    return [{ languageCode: LanguageCode.zh_Hans, name, description }];
}

function discountRateToPercentageOff(value: number | null | undefined): number {
    if (value == null || !Number.isFinite(value) || value <= 0 || value >= 10) {
        throw new UserInputError('折扣必须大于 0 折并且小于 10 折');
    }
    return (10 - value) * 10;
}

function percentageOffToDiscountRate(value: number): number {
    return Math.round((10 - value / 10) * 100) / 100;
}

function couponKindForAction(code: string): StoreCouponCampaignKind | null {
    if (code === 'order_fixed_discount') return 'ORDER_FIXED';
    if (code === 'order_percentage_discount') return 'ORDER_PERCENTAGE';
    if (code === 'store_collection_percentage_discount') return 'COLLECTION_PERCENTAGE';
    if (code === 'products_percentage_discount') return 'PRODUCT_PERCENTAGE';
    return null;
}

function uniqueIds(ids: ID[]): string[] {
    return Array.from(new Set(ids.map(String)));
}

function dateRangesOverlap(
    firstStart: Date | null,
    firstEnd: Date | null,
    secondStart: Date | null,
    secondEnd: Date | null,
): boolean {
    const firstStartTime = firstStart?.getTime() ?? Number.NEGATIVE_INFINITY;
    const firstEndTime = firstEnd?.getTime() ?? Number.POSITIVE_INFINITY;
    const secondStartTime = secondStart?.getTime() ?? Number.NEGATIVE_INFINITY;
    const secondEndTime = secondEnd?.getTime() ?? Number.POSITIVE_INFINITY;
    return firstStartTime < secondEndTime && secondStartTime < firstEndTime;
}

function emptyCampaignStats() {
    return {
        claimedCount: 0,
        availableCount: 0,
        lockedCount: 0,
        usedCount: 0,
        returnedCount: 0,
        expiredCount: 0,
        revokedCount: 0,
        redeemedOrderCount: 0,
        refundedOrderCount: 0,
        discountAmountTotal: 0,
        assistedRevenueTotal: 0,
    };
}
