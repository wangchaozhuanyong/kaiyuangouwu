import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    AdjustmentType,
    CurrencyCode,
    idsAreEqual,
    PromotionCondition,
    PromotionItemAction,
    PromotionLineAction,
    PromotionOrderAction,
    RequestContextCacheService,
    TransactionalConnection,
} from '@vendure/core';

import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { convertChannelAmount } from '../store-currency-price-selection-strategy';

import { couponCollectionsForVariant } from './store-coupon-collections';
import { CouponAudience, couponCustomerEligible } from './store-coupon-eligibility';

let connection: TransactionalConnection;
let requestCache: RequestContextCacheService;

export const customerOrderHistory = new PromotionCondition({
    code: 'store_customer_order_history',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '按本店历史订单限制领券和用券客户' },
        { languageCode: LanguageCode.en, value: 'Restrict coupons by store order history' },
    ],
    args: { audience: { type: 'string' } },
    init(injector) {
        connection = injector.get(TransactionalConnection);
    },
    check(ctx, order, args) {
        return couponCustomerEligible(
            ctx,
            connection,
            args.audience as CouponAudience,
            order.customerId,
            order,
        );
    },
});

export const scopedCouponMinimum = new PromotionCondition({
    code: 'store_scoped_coupon_minimum',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '仅未享受其他商品优惠的指定商品金额计入满减门槛' },
        {
            languageCode: LanguageCode.en,
            value: 'Count only eligible merchandise without other item discounts toward the minimum',
        },
    ],
    args: {
        amount: { type: 'int' },
        currencyCode: { type: 'string' },
        collectionIds: { type: 'ID', list: true },
        productVariantIds: { type: 'ID', list: true },
    },
    init(injector) {
        connection = injector.get(TransactionalConnection);
        requestCache = injector.get(RequestContextCacheService);
    },
    async check(ctx, order, args, promotion) {
        const minimum = convertChannelAmount(
            ctx,
            args.amount,
            args.currencyCode as CurrencyCode,
            ctx.currencyCode,
        );
        const collectionIds = Array.isArray(args.collectionIds) ? args.collectionIds : [];
        const productVariantIds = Array.isArray(args.productVariantIds) ? args.productVariantIds : [];
        if (minimum == null || (!collectionIds.length && !productVariantIds.length)) return false;
        const lines: Array<{ id: string; amount: number }> = [];
        let threshold = 0;
        for (const line of order.lines) {
            if (
                productVariantIds.length &&
                !productVariantIds.some(id => idsAreEqual(id, line.productVariant.id))
            )
                continue;
            if (collectionIds.length) {
                const memberships = await couponCollectionsForVariant(
                    ctx,
                    line.productVariant.id,
                    connection,
                    requestCache,
                );
                if (!collectionIds.some(id => memberships.includes(String(id)))) continue;
            }
            const ownSource = promotion.getSourceId();
            if (
                line.adjustments?.some(
                    adjustment =>
                        adjustment.type === AdjustmentType.PROMOTION &&
                        adjustment.adjustmentSource !== ownSource,
                )
            )
                continue;
            // Vendure re-tests a promotion for every line as earlier lines are adjusted.
            // Add this coupon's own previous line adjustments back so its minimum and
            // proportional allocation stay based on the same pre-coupon merchandise total.
            const quantity = line.quantity ?? 0;
            const proratedOverQuantity = Math.max(line.orderPlacedQuantity ?? quantity, quantity);
            const currentQuantityRatio = proratedOverQuantity === 0 ? 0 : quantity / proratedOverQuantity;
            const ownDiscount = (line.adjustments ?? [])
                .filter(adjustment => adjustment.adjustmentSource === ownSource)
                .reduce((sum, adjustment) => sum + adjustment.amount * currentQuantityRatio, 0);
            const ownDiscountWithTax =
                line.discounts.find(discount => discount.adjustmentSource === ownSource)?.amountWithTax ?? 0;
            const thresholdAmount = line.discountedLinePriceWithTax - ownDiscountWithTax;
            threshold += thresholdAmount;
            const amount = ctx.channel.pricesIncludeTax
                ? thresholdAmount
                : line.discountedLinePrice - ownDiscount;
            if (amount > 0) lines.push({ id: String(line.id), amount });
        }
        return threshold >= minimum && lines.length ? { lines } : false;
    },
    priorityValue: 10,
});

export const scopedCouponFixedDiscount = new PromotionLineAction({
    code: 'store_scoped_coupon_fixed_discount',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '仅向适用商品分摊固定满减金额' },
        { languageCode: LanguageCode.en, value: 'Allocate the fixed discount only to eligible merchandise' },
    ],
    args: { discount: { type: 'int' }, currencyCode: { type: 'string' } },
    conditions: [scopedCouponMinimum],
    execute(ctx, line, args, state) {
        const discount = convertChannelAmount(
            ctx,
            args.discount,
            args.currencyCode as CurrencyCode,
            ctx.currencyCode,
        );
        const lines = state.store_scoped_coupon_minimum?.lines;
        if (discount == null || !lines?.length) return 0;
        const total = lines.reduce((sum, item) => sum + item.amount, 0);
        const cap = Math.min(Math.max(0, discount), total);
        // Cumulative rounding preserves the exact face value, including multi-quantity lines and cents.
        let consumed = 0;
        for (const item of lines) {
            const before = Math.round((cap * consumed) / total);
            consumed += item.amount;
            if (item.id === String(line.id)) return -(Math.round((cap * consumed) / total) - before);
        }
        return 0;
    },
});

export const customerCouponEntitlement = new PromotionCondition({
    code: 'store_customer_coupon_entitlement',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '客户已领取且当前订单锁定了这张优惠券' },
        { languageCode: LanguageCode.en, value: 'Customer owns a coupon locked to this order' },
    ],
    args: {},
    init(injector) {
        connection = injector.get(TransactionalConnection);
    },
    async check(ctx, order, _args, promotion) {
        if (!order.customerId) return false;
        const now = new Date();
        const row = await connection
            .getRepository(ctx, CustomerCoupon)
            .createQueryBuilder('coupon')
            .select('coupon.id', 'id')
            .where('coupon.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('coupon.customerId = :customerId', { customerId: order.customerId })
            .andWhere('coupon.promotionId = :promotionId', { promotionId: promotion.id })
            .andWhere(
                "((coupon.status = 'LOCKED' AND coupon.lockedOrderId = :orderId " +
                    'AND coupon.validFrom <= :now AND (coupon.validUntil IS NULL OR coupon.validUntil > :now)) OR ' +
                    "(coupon.status = 'USED' AND coupon.usedOrderId = :orderId " +
                    'AND coupon.validFrom <= coupon.usedAt ' +
                    'AND (coupon.validUntil IS NULL OR coupon.validUntil > coupon.usedAt)))',
                { orderId: order.id, now },
            )
            .limit(1)
            .getRawOne<{ id: string }>();
        return Boolean(row);
    },
});

interface FlashSaleVariantRule {
    variantId: string;
    salePrice?: number;
    percentageOff?: number;
    currencyCode?: CurrencyCode;
}

export const currencyMinimumOrderAmount = new PromotionCondition({
    code: 'store_currency_minimum_order_amount',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '订单商品小计满指定币种金额' },
        { languageCode: LanguageCode.en, value: 'Order subtotal reaches a currency-aware amount' },
    ],
    args: {
        amount: {
            type: 'int',
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '最低商品小计' },
                { languageCode: LanguageCode.en, value: 'Minimum merchandise subtotal' },
            ],
            description: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '按所选币种的最小货币单位填写，例如 100 表示 1.00。',
                },
                {
                    languageCode: LanguageCode.en,
                    value: 'Enter the amount in minor currency units, for example 100 for 1.00.',
                },
            ],
        },
        currencyCode: {
            type: 'string',
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '金额币种' },
                { languageCode: LanguageCode.en, value: 'Amount currency' },
            ],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '填写三位币种代码，例如 MYR。' },
                { languageCode: LanguageCode.en, value: 'Enter a three-letter currency code, such as MYR.' },
            ],
        },
        taxInclusive: {
            type: 'boolean',
            defaultValue: true,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '按含税商品小计判断' },
                { languageCode: LanguageCode.en, value: 'Use tax-inclusive merchandise subtotal' },
            ],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '开启后，使用含税商品小计判断是否达到门槛。' },
                {
                    languageCode: LanguageCode.en,
                    value: 'Enable this to compare the tax-inclusive merchandise subtotal.',
                },
            ],
        },
    },
    check(ctx, order, args) {
        const amount = convertChannelAmount(
            ctx,
            args.amount,
            args.currencyCode as CurrencyCode,
            ctx.currencyCode,
        );
        if (amount == null) return false;
        return (args.taxInclusive ? order.subTotalWithTax : order.subTotal) >= amount;
    },
    priorityValue: 10,
});

export const currencyOrderFixedDiscount = new PromotionOrderAction({
    code: 'store_currency_order_fixed_discount',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '订单按指定币种固定金额立减' },
        { languageCode: LanguageCode.en, value: 'Apply a currency-aware fixed order discount' },
    ],
    args: {
        discount: {
            type: 'int',
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '固定减免金额' },
                { languageCode: LanguageCode.en, value: 'Fixed discount amount' },
            ],
            description: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '按所选币种的最小货币单位填写，例如 100 表示减免 1.00。',
                },
                {
                    languageCode: LanguageCode.en,
                    value: 'Enter the discount in minor currency units, for example 100 for 1.00.',
                },
            ],
        },
        currencyCode: {
            type: 'string',
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '减免金额币种' },
                { languageCode: LanguageCode.en, value: 'Discount currency' },
            ],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '填写三位币种代码，例如 MYR。' },
                { languageCode: LanguageCode.en, value: 'Enter a three-letter currency code, such as MYR.' },
            ],
        },
    },
    execute(ctx, order, args) {
        const discount = convertChannelAmount(
            ctx,
            args.discount,
            args.currencyCode as CurrencyCode,
            ctx.currencyCode,
        );
        if (discount == null) return 0;
        const upperBound = ctx.channel.pricesIncludeTax ? order.subTotalWithTax : order.subTotal;
        return -Math.min(discount, upperBound);
    },
});

export const collectionPercentageDiscount = new PromotionItemAction({
    code: 'store_collection_percentage_discount',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '指定商品分类减免 { discount }%' },
        { languageCode: LanguageCode.en, value: 'Reduce products in selected categories by { discount }%' },
    ],
    args: {
        discount: {
            type: 'float',
            ui: { component: 'number-form-input', suffix: '%', min: 0 },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '减免比例' },
                { languageCode: LanguageCode.en, value: 'Discount percentage' },
            ],
        },
        collectionIds: {
            type: 'ID',
            list: true,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '商品分类' },
                { languageCode: LanguageCode.en, value: 'Categories' },
            ],
        },
    },
    init(injector) {
        connection = injector.get(TransactionalConnection);
        requestCache = injector.get(RequestContextCacheService);
    },
    async execute(ctx, orderLine, args) {
        const categoryIds = await couponCollectionsForVariant(
            ctx,
            orderLine.productVariant.id,
            connection,
            requestCache,
        );
        const selected = new Set(args.collectionIds.map(String));
        if (!categoryIds.some(id => selected.has(id))) {
            return 0;
        }
        const unitPrice = ctx.channel.pricesIncludeTax ? orderLine.unitPriceWithTax : orderLine.unitPrice;
        const percentage = Math.min(100, Math.max(0, args.discount));
        return -unitPrice * (percentage / 100);
    },
});

export const flashSalePriceAction = new PromotionItemAction({
    code: 'store_flash_sale_price',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '按限时秒杀价结算指定商品' },
        { languageCode: LanguageCode.en, value: 'Apply flash-sale pricing to selected products' },
    ],
    args: {
        variantRules: {
            type: 'string',
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '秒杀商品价格规则' },
                { languageCode: LanguageCode.en, value: 'Flash-sale variant pricing rules' },
            ],
            description: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '秒杀活动生成的商品价格规则，通常应在秒杀活动页面维护。',
                },
                {
                    languageCode: LanguageCode.en,
                    value: 'Product pricing rules generated by the flash-sale campaign editor.',
                },
            ],
        },
    },
    execute(ctx, orderLine, args) {
        const rules = parseFlashSaleVariantRules(args.variantRules);
        const rule = rules.find(candidate => idsAreEqual(candidate.variantId, orderLine.productVariant.id));
        if (!rule) {
            return 0;
        }
        const unitPrice = ctx.channel.pricesIncludeTax ? orderLine.unitPriceWithTax : orderLine.unitPrice;
        const configuredSalePrice =
            rule.salePrice != null
                ? convertChannelAmount(
                      ctx,
                      Math.max(0, rule.salePrice),
                      rule.currencyCode ?? ctx.channel.defaultCurrencyCode,
                      ctx.currencyCode,
                  )
                : null;
        if (rule.salePrice != null && configuredSalePrice == null) return 0;
        const targetPrice =
            configuredSalePrice != null
                ? ctx.channel.pricesIncludeTax || orderLine.unitPriceWithTax <= 0
                    ? configuredSalePrice
                    : Math.round(configuredSalePrice * (orderLine.unitPrice / orderLine.unitPriceWithTax))
                : Math.round(unitPrice * (1 - Math.min(100, Math.max(0, rule.percentageOff ?? 0)) / 100));
        return -Math.max(0, unitPrice - targetPrice);
    },
});

export function parseFlashSaleVariantRules(value: string): FlashSaleVariantRule[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.flatMap(item => {
            if (!item || typeof item !== 'object') return [];
            const candidate = item as Record<string, unknown>;
            if (typeof candidate.variantId !== 'string' || !candidate.variantId.trim()) return [];
            const salePrice =
                typeof candidate.salePrice === 'number' && Number.isFinite(candidate.salePrice)
                    ? Math.round(candidate.salePrice)
                    : undefined;
            const percentageOff =
                typeof candidate.percentageOff === 'number' && Number.isFinite(candidate.percentageOff)
                    ? candidate.percentageOff
                    : undefined;
            const currencyCode =
                candidate.currencyCode === CurrencyCode.CNY || candidate.currencyCode === CurrencyCode.MYR
                    ? candidate.currencyCode
                    : undefined;
            if (salePrice == null && percentageOff == null) return [];
            return [{ variantId: candidate.variantId, salePrice, percentageOff, currencyCode }];
        });
    } catch {
        return [];
    }
}
