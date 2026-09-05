import * as XLSX from 'xlsx';

import { type CatalogExportFormat } from './catalog-export-file';
import { type CatalogExportRowRecord } from './catalog-management.graphql';

export function buildCatalogExport(
    rows: CatalogExportRowRecord[],
    format: CatalogExportFormat,
    stockLocationId?: string,
) {
    if (format === 'csv') {
        const sheet = productSheet(rows, stockLocationId);
        const csv = `\uFEFF${XLSX.utils.sheet_to_csv(sheet)}`;
        return {
            buffer: new TextEncoder().encode(csv).buffer,
            mimeType: 'text/csv;charset=utf-8',
            extension: 'csv' as const,
        };
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, productSheet(rows, stockLocationId), '商品与SKU');
    XLSX.utils.book_append_sheet(workbook, stockSheet(rows), '库存策略');
    XLSX.utils.book_append_sheet(workbook, lotSheet(rows), '批次效期');
    XLSX.utils.book_append_sheet(workbook, guideSheet(), '字段说明');
    const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
    return {
        buffer: output instanceof ArrayBuffer ? output : new Uint8Array(output).buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx' as const,
    };
}

function productSheet(rows: CatalogExportRowRecord[], stockLocationId?: string): XLSX.WorkSheet {
    const values = [
        [
            '名称',
            '分类',
            'SKU',
            '仓库',
            '库存量',
            '进货价',
            '销售价',
            '毛利率',
            '库存上限',
            '库存下限',
            '商品状态',
            '商品描述',
            '标签',
            '条码',
            '规格',
            '销售单位',
            '采购单位',
            '包装换算',
            '币种',
            '品牌',
            'SKU状态',
            '保质期',
            '创建日期',
            '系统创建时间',
            '供货商',
        ],
        ...rows.map(row => {
            const stock = selectedStock(row, stockLocationId);
            return [
                row.productName,
                row.categories[0] ?? '',
                safeText(row.sku),
                stock?.stockLocationName ?? '',
                stock?.stockOnHand ?? null,
                row.purchaseCostMicrounits == null ? null : row.purchaseCostMicrounits / 1_000,
                row.sellingPrice / 100,
                row.margin,
                stock?.maximumStock ?? null,
                stock?.minimumStock ?? null,
                row.productEnabled ? '启用' : '禁用',
                row.description,
                row.tags.join('，'),
                safeText(row.barcode),
                row.specification,
                row.saleUnit,
                row.purchaseUnit,
                row.packageQuantity,
                row.currencyCode,
                row.brand ?? '',
                row.variantEnabled ? '启用' : '禁用',
                row.shelfLifeDays,
                dateCell(row.sourceCreatedAt),
                dateCell(row.systemCreatedAt),
                safeText(row.supplierName ?? ''),
            ];
        }),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(values, { cellDates: true });
    sheet['!cols'] = [
        24, 18, 18, 20, 12, 12, 12, 10, 12, 12, 10, 36, 22, 18, 16, 12, 12, 10, 8, 16, 10, 10, 18, 20, 20,
    ].map(wch => ({ wch }));
    applyNumberFormat(sheet, rows.length, 'E', '#,##0');
    applyNumberFormat(sheet, rows.length, 'F', '#,##0.000');
    applyNumberFormat(sheet, rows.length, 'G', '#,##0.00');
    applyNumberFormat(sheet, rows.length, 'H', '0.0%');
    applyNumberFormat(sheet, rows.length, 'I', '#,##0');
    applyNumberFormat(sheet, rows.length, 'J', '#,##0');
    applyNumberFormat(sheet, rows.length, 'W', 'yyyy-mm-dd');
    applyNumberFormat(sheet, rows.length, 'X', 'yyyy-mm-dd hh:mm');
    return sheet;
}

function stockSheet(rows: CatalogExportRowRecord[]): XLSX.WorkSheet {
    const values = [
        ['SKU', '仓库', '库存量', '已分配', '可用库存', '库存下限', '库存上限'],
        ...rows.flatMap(row =>
            row.stockLevels.map(stock => [
                safeText(row.sku),
                stock.stockLocationName,
                stock.stockOnHand,
                stock.stockAllocated,
                stock.stockAvailable,
                stock.minimumStock,
                stock.maximumStock,
            ]),
        ),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(values);
    sheet['!cols'] = [18, 20, 12, 12, 12, 12, 12].map(wch => ({ wch }));
    return sheet;
}

function lotSheet(rows: CatalogExportRowRecord[]): XLSX.WorkSheet {
    const values = [
        ['SKU', '仓库', '批次号', '生产日期', '到期日期', '批次数量', '批次进货价', '币种', '状态'],
        ...rows.flatMap(row =>
            row.lots.map(lot => [
                safeText(row.sku),
                lot.stockLocationName,
                safeText(lot.lotCode),
                dateCell(lot.manufacturedAt),
                dateCell(lot.expiresAt),
                lot.quantityOnHand,
                lot.purchaseCostMicrounits == null ? null : lot.purchaseCostMicrounits / 1_000,
                lot.currencyCode,
                lot.state,
            ]),
        ),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(values, { cellDates: true });
    sheet['!cols'] = [18, 20, 18, 14, 14, 12, 14, 8, 12].map(wch => ({ wch }));
    const rowCount = values.length - 1;
    applyNumberFormat(sheet, rowCount, 'D', 'yyyy-mm-dd');
    applyNumberFormat(sheet, rowCount, 'E', 'yyyy-mm-dd');
    applyNumberFormat(sheet, rowCount, 'G', '#,##0.000');
    return sheet;
}

function guideSheet(): XLSX.WorkSheet {
    const values = [
        ['工作表', '字段', '规则'],
        ['商品与SKU', 'SKU', '稳定更新键，后续维护时不应删除或修改；调整行顺序不影响匹配'],
        ['商品与SKU', '库存量', '以所选默认回导仓库为准，导入时按绝对数覆盖，不按增减量计算'],
        ['商品与SKU', '空白单元格', '默认保留系统原值；只有明确启用高风险空白清除模式才会清空可清除字段'],
        ['商品与SKU', '缺失行', '文件中缺少的旧 SKU 保持不变，不会自动删除或禁用'],
        ['商品与SKU', '毛利率', '系统根据销售价和最新进货价计算，不作为导入权威值'],
        ['商品与SKU', '创建日期', '保存来源报表日期，不覆盖系统创建时间'],
        ['商品与SKU', 'SKU状态', 'SKU 可独立停用；未填写时沿用商品状态'],
        ['商品与SKU', '系统创建时间', '只读审计字段，重新导入时不会覆盖系统时间'],
        ['商品与SKU', '供货商', '按当前门店为 SKU 保存一个默认供货商；“无”表示不绑定'],
        ['库存策略', '库存量、上下限', '按 SKU 与仓库记录；数量必须为整数'],
        ['批次效期', '批次号、生产日期、到期日期', '同一 SKU、仓库、批次号必须唯一'],
        ['隐私', '原始文件', '文件在浏览器本地解析，服务器只接收用户确认后的标准化字段'],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(values);
    sheet['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 72 }];
    return sheet;
}

function selectedStock(row: CatalogExportRowRecord, stockLocationId?: string) {
    if (!stockLocationId) return row.stockLevels[0];
    return row.stockLevels.find(stock => String(stock.stockLocationId) === String(stockLocationId));
}

function dateCell(value: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function safeText(value: string): string {
    return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

function applyNumberFormat(sheet: XLSX.WorkSheet, rowCount: number, column: string, format: string): void {
    for (let row = 2; row <= rowCount + 1; row++) {
        const cell = sheet[`${column}${row}`];
        if (cell) cell.z = format;
    }
}
