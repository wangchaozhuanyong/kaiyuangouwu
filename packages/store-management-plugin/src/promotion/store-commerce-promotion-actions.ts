import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    idsAreEqual,
    ProductVariant,
    PromotionItemAction,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

let connection: TransactionalConnection;

interface FlashSaleVariantRule {
    variantId: string;
    salePrice?: number;
    percentageOff?: number;
}

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
    },
    async execute(ctx, orderLine, args) {
        if (!(await variantBelongsToCollections(ctx, orderLine.productVariant.id, args.collectionIds))) {
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
        },
    },
    execute(ctx, orderLine, args) {
        const rules = parseFlashSaleVariantRules(args.variantRules);
        const rule = rules.find(candidate => idsAreEqual(candidate.variantId, orderLine.productVariant.id));
        if (!rule) {
            return 0;
        }
        const unitPrice = ctx.channel.pricesIncludeTax ? orderLine.unitPriceWithTax : orderLine.unitPrice;
        const configuredSalePrice = rule.salePrice != null ? Math.max(0, rule.salePrice) : null;
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
            if (salePrice == null && percentageOff == null) return [];
            return [{ variantId: candidate.variantId, salePrice, percentageOff }];
        });
    } catch {
        return [];
    }
}

async function variantBelongsToCollections(
    ctx: RequestContext,
    variantId: ID,
    collectionIds: ID[],
): Promise<boolean> {
    if (!collectionIds.length) {
        return false;
    }
    const variant = await connection.getRepository(ctx, ProductVariant).findOne({
        where: { id: variantId },
        relations: { collections: true },
    });
    return Boolean(
        variant?.collections.some(collection =>
            collectionIds.some(collectionId => idsAreEqual(collection.id, collectionId)),
        ),
    );
}
