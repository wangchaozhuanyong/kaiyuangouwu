import type { NormalizedCatalogRow } from './types';

export interface CatalogFieldDefinition {
    value: keyof NormalizedCatalogRow;
    label: string;
    aliases: readonly string[];
}

export const CATALOG_FIELD_DEFINITIONS = [
    {
        value: 'channelCode',
        label: '导入商店',
        aliases: ['门店', '门店编码', '商店', '店铺', '目标商店', '商店编码'],
    },
    { value: 'name', label: '名称', aliases: ['商品名称'] },
    { value: 'fulfillmentType', label: '商品类型', aliases: ['货品类型'] },
    { value: 'category', label: '一级分类', aliases: ['分类', '商品分类'] },
    { value: 'secondaryCategory', label: '二级分类', aliases: ['子分类'] },
    { value: 'sku', label: 'SKU', aliases: ['商品编码'] },
    { value: 'barcode', label: '条码', aliases: [] },
    { value: 'specification', label: '规格', aliases: [] },
    { value: 'primaryUnit', label: '销售单位', aliases: ['主单位', '单位'] },
    { value: 'purchaseUnit', label: '采购单位', aliases: [] },
    { value: 'packageQuantity', label: '包装换算', aliases: ['包装换算数量'] },
    { value: 'currencyCode', label: '币种', aliases: [] },
    { value: 'purchaseCost', label: '进货价', aliases: ['成本价'] },
    { value: 'sellingPrice', label: '销售价', aliases: ['售价', '销售价格'] },
    { value: 'reportedMargin', label: '毛利率', aliases: ['报表毛利率'] },
    { value: 'stockLocationCode', label: '仓库', aliases: ['仓库编码'] },
    { value: 'stockOnHand', label: '库存量', aliases: ['库存', '库存数量'] },
    { value: 'maximumStock', label: '库存上限', aliases: [] },
    { value: 'minimumStock', label: '库存下限', aliases: [] },
    { value: 'brand', label: '品牌', aliases: [] },
    { value: 'tags', label: '标签', aliases: [] },
    { value: 'enabled', label: '商品状态', aliases: ['状态'] },
    { value: 'variantEnabled', label: 'SKU状态', aliases: ['SKU 状态'] },
    { value: 'description', label: '商品描述', aliases: ['描述'] },
    { value: 'manufacturedAt', label: '生产日期', aliases: [] },
    { value: 'shelfLifeDays', label: '保质期', aliases: ['保质期天数'] },
    { value: 'lotCode', label: '批次号', aliases: [] },
    { value: 'lotQuantity', label: '批次数量', aliases: [] },
    { value: 'sourceCreatedAt', label: '创建日期', aliases: ['来源创建日期'] },
    { value: 'supplier', label: '供货商', aliases: ['供应商'] },
] as const satisfies readonly CatalogFieldDefinition[];

export const CATALOG_FIELD_OPTIONS: Array<{ value: keyof NormalizedCatalogRow; label: string }> =
    CATALOG_FIELD_DEFINITIONS.map(({ value, label }) => ({ value, label }));

export const CATALOG_HEADER_ALIASES: Record<string, keyof NormalizedCatalogRow> = Object.fromEntries(
    CATALOG_FIELD_DEFINITIONS.flatMap(({ value, label, aliases }) =>
        [label, ...aliases].map(header => [header.replace(/\s+/gu, ''), value] as const),
    ),
);

export const CATALOG_REQUIRED_FIELDS: Array<keyof NormalizedCatalogRow> = [
    'channelCode',
    'name',
    'fulfillmentType',
    'category',
    'purchaseCost',
    'sellingPrice',
];

export const CATALOG_EXCLUDED_HEADERS = new Set([
    '扩展条码',
    '主编码',
    '批发价',
    '会员价',
    '会员折扣',
    '积分商品',
    '库位',
    '拼音码',
    '货号',
    '自定义1',
    '自定义2',
    '自定义3',
    '重量',
    '是否称重',
    '是否传秤',
    '是否计数商品',
    '称编码',
    '系统创建时间',
]);

export const CATALOG_CANONICAL_BUSINESS_HEADERS = [
    '导入商店',
    '名称',
    '商品类型',
    '一级分类',
    '二级分类',
    '库存量',
    '进货价',
    '销售价',
    '毛利率',
    '库存上限',
    '库存下限',
    '商品状态',
    '商品描述',
    '标签',
] as const;

export function catalogFieldLabel(field: keyof NormalizedCatalogRow): string {
    return CATALOG_FIELD_DEFINITIONS.find(definition => definition.value === field)?.label ?? String(field);
}
