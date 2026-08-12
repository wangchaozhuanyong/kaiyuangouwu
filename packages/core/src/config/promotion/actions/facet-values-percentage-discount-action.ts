import { LanguageCode } from '@vendure/common/lib/generated-types';

import { FacetValueChecker } from '../../../service/helpers/facet-value-checker/facet-value-checker';
import { PromotionItemAction } from '../promotion-action';

let facetValueChecker: FacetValueChecker;

export const discountOnItemWithFacets = new PromotionItemAction({
    code: 'facet_based_discount',
    args: {
        discount: {
            type: 'float',
            ui: {
                component: 'number-form-input',
                suffix: '%',
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Discount percentage' },
                { languageCode: LanguageCode.zh_Hans, value: '减免比例' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Percentage deducted from each qualifying item.' },
                { languageCode: LanguageCode.zh_Hans, value: '每件符合条件的商品按此比例减免。' },
            ],
        },
        facets: {
            type: 'ID',
            list: true,
            ui: { component: 'facet-value-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Filter attribute values' },
                { languageCode: LanguageCode.zh_Hans, value: '筛选属性值' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Select the attribute values used to identify discounted items.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '选择用于判断优惠商品的筛选属性值。' },
            ],
        },
    },
    init(injector) {
        facetValueChecker = injector.get(FacetValueChecker);
    },
    async execute(ctx, orderLine, args) {
        if (await facetValueChecker.hasFacetValues(orderLine, args.facets, ctx)) {
            const unitPrice = ctx.channel.pricesIncludeTax ? orderLine.unitPriceWithTax : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Reduce items with the specified filter attributes by { discount }%',
        },
        { languageCode: LanguageCode.zh_Hans, value: '指定筛选属性的商品减免 { discount }%' },
    ],
});
