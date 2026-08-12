import { LanguageCode } from '@vendure/common/lib/generated-types';

import { FacetValueChecker } from '../../../service/helpers/facet-value-checker/facet-value-checker';
import { PromotionCondition } from '../promotion-condition';

let facetValueChecker: FacetValueChecker;

export const hasFacetValues = new PromotionCondition({
    code: 'at_least_n_with_facets',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Buy at least { minimum } items with the specified filter attributes',
        },
        {
            languageCode: LanguageCode.zh_Hans,
            value: '购买带有指定筛选属性的商品满 { minimum } 件',
        },
    ],
    args: {
        minimum: {
            type: 'int',
            defaultValue: 1,
            ui: { component: '', min: 1 },
            label: [
                { languageCode: LanguageCode.en, value: 'Minimum quantity' },
                { languageCode: LanguageCode.zh_Hans, value: '最低购买件数' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Required quantity of qualifying items.' },
                { languageCode: LanguageCode.zh_Hans, value: '符合指定属性的商品至少需要购买多少件。' },
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
                    value: 'Select the attribute values used to identify qualifying items.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '选择用于判断活动商品的筛选属性值。' },
            ],
        },
    },
    init(injector) {
        facetValueChecker = injector.get(FacetValueChecker);
    },
    // eslint-disable-next-line no-shadow,@typescript-eslint/no-shadow
    async check(ctx, order, args) {
        let matches = 0;
        if (args.minimum < 1) return false;
        for (const line of order.lines) {
            if (await facetValueChecker.hasFacetValues(line, args.facets, ctx)) {
                matches += line.quantity;
            }
        }
        return args.minimum <= matches;
    },
});
