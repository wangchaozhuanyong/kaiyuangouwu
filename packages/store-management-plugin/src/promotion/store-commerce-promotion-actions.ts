import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    CurrencyCode,
    idsAreEqual,
    PromotionCondition,
    PromotionItemAction,
    PromotionOrderAction,
    RequestContextCacheService,
    TransactionalConnection,
} from '@vendure/core';

import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { convertChannelAmount } from '../store-currency-price-selection-strategy';

import { couponCollectionsForVariant } from './store-coupon-collections';

let connection: TransactionalConnection;
let requestCache: RequestContextCacheService;

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
