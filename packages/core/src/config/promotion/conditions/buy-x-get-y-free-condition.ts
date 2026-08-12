import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { PromotionCondition } from '../promotion-condition';

export const buyXGetYFreeCondition = new PromotionCondition({
    code: 'buy_x_get_y_free',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Buy { amountX } qualifying items and get { amountY } selected items free',
        },
        {
            languageCode: LanguageCode.zh_Hans,
            value: '购买指定商品满 { amountX } 件，赠送指定商品 { amountY } 件',
        },
    ],
    args: {
        amountX: {
            type: 'int',
            defaultValue: 2,
            ui: { component: '', min: 1 },
            label: [
                { languageCode: LanguageCode.en, value: 'Purchase threshold' },
                { languageCode: LanguageCode.zh_Hans, value: '购买门槛件数' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Quantity required to earn the free items.' },
                { languageCode: LanguageCode.zh_Hans, value: '购买活动商品达到此件数后可获得赠品。' },
            ],
        },
        variantIdsX: {
            type: 'ID',
            list: true,
            ui: { component: 'product-selector-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Qualifying product SKUs' },
                { languageCode: LanguageCode.zh_Hans, value: '参与门槛的商品 SKU' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Select the product SKUs counted toward the threshold.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '选择用于累计购买门槛的商品 SKU。' },
            ],
        },
        amountY: {
            type: 'int',
            defaultValue: 1,
            ui: { component: '', min: 0 },
            label: [
                { languageCode: LanguageCode.en, value: 'Free quantity' },
                { languageCode: LanguageCode.zh_Hans, value: '赠送件数' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Number of selected items given free.' },
                { languageCode: LanguageCode.zh_Hans, value: '每次满足购买门槛后赠送的商品件数。' },
            ],
        },
        variantIdsY: {
            type: 'ID',
            list: true,
            ui: { component: 'product-selector-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Free product SKUs' },
                { languageCode: LanguageCode.zh_Hans, value: '赠送的商品 SKU' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Select the product SKUs that can be given free.' },
                { languageCode: LanguageCode.zh_Hans, value: '选择可作为赠品的商品 SKU。' },
            ],
        },
    },
    async check(ctx, order, args) {
        const xIds = createIdentityMap(args.variantIdsX);
        const yIds = createIdentityMap(args.variantIdsY);
        if (args.amountX < 1) return false;
        let matches = 0;
        const freeItemCandidates: OrderLine[] = [];
        for (const line of order.lines) {
            const variantId = line.productVariant.id;
            if (variantId in xIds) {
                matches += line.quantity;
            }
            if (variantId in yIds) {
                freeItemCandidates.push(line);
            }
        }
        const quantity = Math.floor(matches / args.amountX);
        if (!quantity || !freeItemCandidates.length) return false;
        const freeLines = freeItemCandidates.sort((a, b) => {
            const unitPriceA = ctx.channel.pricesIncludeTax ? a.unitPriceWithTax : a.unitPrice;
            const unitPriceB = ctx.channel.pricesIncludeTax ? b.unitPriceWithTax : b.unitPrice;
            if (unitPriceA < unitPriceB) return -1;
            if (unitPriceA > unitPriceB) return 1;
            return 0;
        });
        let placesToAllocate = args.amountY;
        const freeItemsPerLine: { [lineId: string]: number } = {};
        for (const freeLine of freeLines) {
            if (placesToAllocate === 0) break;
            const freeQuantity = Math.min(freeLine.quantity, placesToAllocate);
            freeItemsPerLine[freeLine.id] = freeQuantity;
            placesToAllocate -= freeQuantity;
        }
        return { freeItemsPerLine };
    },
});

function createIdentityMap(ids: ID[]): Record<ID, ID> {
    return ids.reduce((map: Record<ID, ID>, id) => ({ ...map, [id]: id }), {});
}
