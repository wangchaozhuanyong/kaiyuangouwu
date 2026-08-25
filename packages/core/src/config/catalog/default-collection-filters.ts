import { LanguageCode } from '@vendure/common/lib/generated-types';

import { ConfigArgDef } from '../../common/configurable-operation';
import { UserInputError } from '../../common/error/errors';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { CollectionFilter } from './collection-filter';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { customAlphabet } = require('nanoid');

/**
 * @description
 * Used to created unique key names for DB query parameters, to avoid conflicts if the
 * same filter is applied multiple times.
 */
export function randomSuffix(prefix: string) {
    const nanoid = customAlphabet('123456789abcdefghijklmnopqrstuvwxyz', 6);
    return `${prefix}_${nanoid() as string}`;
}

/**
 * @description
 * Add this to your CollectionFilter `args` object to display the standard UI component
 * for selecting the combination mode when working with multiple filters.
 */
export const combineWithAndArg: ConfigArgDef<'boolean'> = {
    type: 'boolean',
    label: [
        { languageCode: LanguageCode.en, value: 'Combination mode' },
        { languageCode: LanguageCode.zh_Hans, value: '组合方式' },
    ],
    description: [
        {
            languageCode: LanguageCode.en,
            // eslint-disable-next-line max-len
            value: 'If this filter is being combined with other filters, do all conditions need to be satisfied (AND), or just one or the other (OR)?',
        },
        {
            languageCode: LanguageCode.zh_Hans,
            value: '与其他规则同时使用时，选择必须全部满足（且），还是满足任意一条（或）。',
        },
    ],
    defaultValue: true,
    ui: {
        component: 'combination-mode-form-input',
    },
};

/**
 * Filters for ProductVariants having the given facetValueIds (including parent Product)
 */
export const facetValueCollectionFilter = new CollectionFilter({
    args: {
        facetValueIds: {
            type: 'ID',
            list: true,
            ui: {
                component: 'facet-value-form-input',
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Filter attribute values' },
                { languageCode: LanguageCode.zh_Hans, value: '筛选属性值' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Select the attribute values used to match product SKUs.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '选择用于匹配商品 SKU 的筛选属性值。' },
            ],
        },
        containsAny: {
            type: 'boolean',
            label: [
                { languageCode: LanguageCode.en, value: 'Match any selected value' },
                { languageCode: LanguageCode.zh_Hans, value: '匹配任意所选值' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value:
                        'If checked, product variants must have at least one of the selected facet values. ' +
                        'If not checked, the variant must have all selected values.',
                },
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '开启后，商品 SKU 只需具备任意一个所选属性值；关闭后，必须同时具备全部所选值。',
                },
            ],
        },
        combineWithAnd: combineWithAndArg,
    },
    code: 'facet-value-filter',
    description: [
        { languageCode: LanguageCode.en, value: 'Filter product SKUs by attribute values' },
        { languageCode: LanguageCode.zh_Hans, value: '按筛选属性值匹配商品 SKU' },
    ],
    apply: (qb, args) => {
        const ids = args.facetValueIds;

        if (ids.length) {
            // uuid IDs can include `-` chars, which we cannot use in a TypeORM key name.
            const safeIdsConcat = ids.join('_').replace(/-/g, '_');
            const idsName = `ids_${safeIdsConcat}`;
            const countName = `count_${safeIdsConcat}`;
            const productFacetValues = qb.connection
                .createQueryBuilder(ProductVariant, 'product_variant')
                .select('product_variant.id', 'variant_id')
                .addSelect('facet_value.id', 'facet_value_id')
                .leftJoin('product_variant.facetValues', 'facet_value')
                .where(`facet_value.id IN (:...${idsName})`);

            const variantFacetValues = qb.connection
                .createQueryBuilder(ProductVariant, 'product_variant')
                .select('product_variant.id', 'variant_id')
                .addSelect('facet_value.id', 'facet_value_id')
                .leftJoin('product_variant.product', 'product')
                .leftJoin('product.facetValues', 'facet_value')
                .where(`facet_value.id IN (:...${idsName})`);

            const union = qb.connection
                .createQueryBuilder()
                .select('union_table.variant_id')
                .from(
                    `(${productFacetValues.getQuery()} UNION ${variantFacetValues.getQuery()})`,
                    'union_table',
                )
                .groupBy('variant_id')
                .having(`COUNT(*) >= :${countName}`);

            const variantIds = qb.connection
                .createQueryBuilder()
                .select('variant_ids_table.variant_id')
                .from(`(${union.getQuery()})`, 'variant_ids_table');

            const clause = `productVariant.id IN (${variantIds.getQuery()})`;
            const params = {
                [idsName]: ids,
                [countName]: args.containsAny ? 1 : ids.length,
            };
            if (args.combineWithAnd !== false) {
                qb.andWhere(clause).setParameters(params);
            } else {
                qb.orWhere(clause).setParameters(params);
            }
        } else {
            // If no facetValueIds are specified, no ProductVariants will be matched.
            if (args.combineWithAnd !== false) {
                qb.andWhere('1 = 0');
            }
        }
        return qb;
    },
});

export const variantNameCollectionFilter = new CollectionFilter({
    args: {
        operator: {
            type: 'string',
            ui: {
                component: 'select-form-input',
                options: [
                    {
                        value: 'startsWith',
                        label: [
                            { languageCode: LanguageCode.en, value: 'Starts with' },
                            { languageCode: LanguageCode.zh_Hans, value: '开头是' },
                        ],
                    },
                    {
                        value: 'endsWith',
                        label: [
                            { languageCode: LanguageCode.en, value: 'Ends with' },
                            { languageCode: LanguageCode.zh_Hans, value: '结尾是' },
                        ],
                    },
                    {
                        value: 'contains',
                        label: [
                            { languageCode: LanguageCode.en, value: 'Contains' },
                            { languageCode: LanguageCode.zh_Hans, value: '包含' },
                        ],
                    },
                    {
                        value: 'doesNotContain',
                        label: [
                            { languageCode: LanguageCode.en, value: 'Does not contain' },
                            { languageCode: LanguageCode.zh_Hans, value: '不包含' },
                        ],
                    },
                ],
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Matching method' },
                { languageCode: LanguageCode.zh_Hans, value: '匹配方式' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Choose how the name text should be matched.' },
                { languageCode: LanguageCode.zh_Hans, value: '选择商品 SKU 名称与关键词的匹配方式。' },
            ],
        },
        term: {
            type: 'string',
            label: [
                { languageCode: LanguageCode.en, value: 'Name text' },
                { languageCode: LanguageCode.zh_Hans, value: '名称关键词' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Text to match against the product SKU name.' },
                { languageCode: LanguageCode.zh_Hans, value: '输入需要匹配的商品 SKU 名称文字。' },
            ],
        },
        combineWithAnd: combineWithAndArg,
    },
    code: 'variant-name-filter',
    description: [
        { languageCode: LanguageCode.en, value: 'Filter by product SKU name' },
        { languageCode: LanguageCode.zh_Hans, value: '按商品 SKU 名称筛选' },
    ],
    apply: (qb, args) => {
        let translationAlias = 'variant_name_filter_translation';
        const termName = randomSuffix('term');
        const translationsJoin = qb.expressionMap.joinAttributes.find(
            ja => ja.entityOrProperty === 'productVariant.translations',
        );
        if (!translationsJoin) {
            qb.leftJoin('productVariant.translations', translationAlias);
        } else {
            translationAlias = translationsJoin.alias.name;
        }
        const LIKE = qb.connection.options.type === 'postgres' ? 'ILIKE' : 'LIKE';
        let clause: string;
        let params: Record<string, string>;
        switch (args.operator) {
            case 'contains':
                clause = `${translationAlias}.name ${LIKE} :${termName}`;
                params = {
                    [termName]: `%${args.term}%`,
                };
                break;
            case 'doesNotContain':
                clause = `${translationAlias}.name NOT ${LIKE} :${termName}`;
                params = {
                    [termName]: `%${args.term}%`,
                };
                break;
            case 'startsWith':
                clause = `${translationAlias}.name ${LIKE} :${termName}`;
                params = {
                    [termName]: `${args.term}%`,
                };
                break;
            case 'endsWith':
                clause = `${translationAlias}.name ${LIKE} :${termName}`;
                params = {
                    [termName]: `%${args.term}`,
                };
                break;
            default:
                throw new UserInputError(`${args.operator} is not a valid operator`);
        }
        if (args.combineWithAnd === false) {
            return qb.orWhere(clause, params);
        } else {
            return qb.andWhere(clause, params);
        }
    },
});

export const variantIdCollectionFilter = new CollectionFilter({
    args: {
        variantIds: {
            type: 'ID',
            list: true,
            label: [
                { languageCode: LanguageCode.en, value: 'Product SKUs' },
                { languageCode: LanguageCode.zh_Hans, value: '商品 SKU' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Select the product SKUs included in this group.' },
                { languageCode: LanguageCode.zh_Hans, value: '选择需要加入该商品分类的商品 SKU。' },
            ],
            ui: {
                component: 'product-multi-form-input',
                selectionMode: 'variant',
            },
        },
        combineWithAnd: combineWithAndArg,
    },
    code: 'variant-id-filter',
    description: [
        { languageCode: LanguageCode.en, value: 'Manually select product SKUs' },
        { languageCode: LanguageCode.zh_Hans, value: '手动选择商品 SKU' },
    ],
    apply: (qb, args) => {
        const emptyIds = args.variantIds.length === 0;
        const variantIdsKey = randomSuffix('variantIds');
        const clause = `productVariant.id IN (:...${variantIdsKey})`;
        const params = { [variantIdsKey]: args.variantIds };
        if (args.combineWithAnd === false) {
            if (emptyIds) {
                return qb;
            }
            return qb.orWhere(clause, params);
        } else {
            if (emptyIds) {
                return qb.andWhere('1 = 0');
            }
            return qb.andWhere(clause, params);
        }
    },
});

export const productIdCollectionFilter = new CollectionFilter({
    args: {
        productIds: {
            type: 'ID',
            list: true,
            label: [
                { languageCode: LanguageCode.en, value: 'Products' },
                { languageCode: LanguageCode.zh_Hans, value: '商品' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Select the products included in this group.' },
                { languageCode: LanguageCode.zh_Hans, value: '选择需要加入该商品分类的商品。' },
            ],
            ui: {
                component: 'product-multi-form-input',
                selectionMode: 'product',
            },
        },
        combineWithAnd: combineWithAndArg,
    },
    code: 'product-id-filter',
    description: [
        { languageCode: LanguageCode.en, value: 'Manually select products' },
        { languageCode: LanguageCode.zh_Hans, value: '手动选择商品' },
    ],
    apply: (qb, args) => {
        const emptyIds = args.productIds.length === 0;
        const productIdsKey = randomSuffix('productIds');
        const clause = `productVariant.productId IN (:...${productIdsKey})`;
        const params = { [productIdsKey]: args.productIds };
        if (args.combineWithAnd === false) {
            if (emptyIds) {
                return qb;
            }
            return qb.orWhere(clause, params);
        } else {
            if (emptyIds) {
                return qb.andWhere('1 = 0');
            }
            return qb.andWhere(clause, params);
        }
    },
});

export const defaultCollectionFilters = [
    facetValueCollectionFilter,
    variantNameCollectionFilter,
    variantIdCollectionFilter,
    productIdCollectionFilter,
];
