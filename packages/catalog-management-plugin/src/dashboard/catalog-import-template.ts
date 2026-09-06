import type { NormalizedCatalogRow } from '../types';

import { CATALOG_FIELD_DEFINITIONS } from '../catalog-field-definitions';

export function catalogImportTemplateCsv(channelCode: string): string {
    const examples: Array<Partial<Record<keyof NormalizedCatalogRow, string | number>>> = [
        {
            name: '示例实物商品',
            fulfillmentType: '实物',
            category: '食品饮料',
            secondaryCategory: '饮料',
            sku: 'EXAMPLE-PHYSICAL-001',
            specification: '500ml',
            primaryUnit: '瓶',
            purchaseUnit: '箱',
            packageQuantity: 12,
            stockOnHand: 10,
            purchaseCost: 3.125,
            sellingPrice: 5,
        },
        {
            name: '示例虚拟货品',
            fulfillmentType: '虚拟货品',
            category: '数字服务',
            secondaryCategory: '',
            sku: 'EXAMPLE-DIGITAL-001',
            primaryUnit: '份',
            packageQuantity: 1,
            purchaseCost: 5,
            sellingPrice: 10,
        },
    ];
    const rows = [
        CATALOG_FIELD_DEFINITIONS.map(field => field.label),
        ...examples.map(example =>
            CATALOG_FIELD_DEFINITIONS.map(field =>
                field.value === 'channelCode' ? channelCode : (example[field.value] ?? ''),
            ),
        ),
    ];
    return rows
        .map(row => row.map(value => `"${String(value).replace(/"/gu, '""')}"`).join(','))
        .join('\r\n');
}
