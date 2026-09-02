import { normalizeString } from '@vendure/common/lib/normalize-string';
import { FacetValue, UserInputError } from '@vendure/core';

import { normalizeSupplierDisplayName } from './catalog-supplier.service';
import { MAX_CATALOG_IMPORT_BYTES, MAX_CATALOG_IMPORT_ROWS } from './constants';
import { BeginCatalogImportInput, NormalizedCatalogRow } from './types';

export function optionalUpdate(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
    clear: boolean,
): void {
    if (!isBlankValue(value)) target[key] = value;
    else if (clear) target[key] = null;
}

export function shouldClear(
    row: NormalizedCatalogRow,
    field: keyof NormalizedCatalogRow,
    clearBlankFields: boolean,
): boolean {
    if (!clearBlankFields) return false;
    if (row.raw && Object.prototype.hasOwnProperty.call(row.raw, field)) {
        return isBlankValue(row.raw[String(field)]);
    }
    if (!row.providedFields?.includes(String(field))) return false;
    return isBlankValue(row[field]);
}

export function clearsVariantIdentity(row: NormalizedCatalogRow, clearBlankFields: boolean): boolean {
    return (
        shouldClear(row, 'specification', clearBlankFields) ||
        shouldClear(row, 'primaryUnit', clearBlankFields)
    );
}

export function isBlankValue(value: unknown): boolean {
    return (
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0)
    );
}

export function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function facetNames(values: FacetValue[] | undefined, facetCode: string): string[] {
    return (values ?? [])
        .filter(value => value.facet?.code === facetCode)
        .map(value => value.translations[0]?.name ?? value.code)
        .sort((left, right) => left.localeCompare(right, 'zh-Hans'));
}

export function manualProductFilter(productIds: string[], combineWithAnd = true) {
    return {
        code: 'product-id-filter',
        arguments: [
            { name: 'productIds', value: JSON.stringify(productIds) },
            { name: 'combineWithAnd', value: String(combineWithAnd) },
        ],
    };
}

export function parseIdList(value?: string): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

export function shortCode(value: string): string {
    const normalized = normalizeString(value, '-').replace(/^-|-$/g, '');
    if (normalized) return normalized.slice(0, 64);
    return Buffer.from(value).toString('hex').slice(0, 32);
}

export function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function stringOrNumberValue(value: unknown): string {
    if (typeof value === 'string') return value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

export function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function nullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function dateString(value: unknown): string | null {
    return dateValue(value)?.toISOString() ?? null;
}

export function dateValue(value: unknown): Date | null {
    if (value == null || value === '') return null;
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String) : [];
}

export function recordValue(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

export function safeMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export function validateImportSource(input: BeginCatalogImportInput): void {
    if (
        !Number.isInteger(input.totalRows) ||
        input.totalRows < 1 ||
        input.totalRows > MAX_CATALOG_IMPORT_ROWS
    ) {
        throw new UserInputError(`单次最多导入 ${MAX_CATALOG_IMPORT_ROWS} 行商品`);
    }
    if (!Number.isInteger(input.source.byteSize) || input.source.byteSize < 1) {
        throw new UserInputError('文件大小无效');
    }
    if (input.source.byteSize > MAX_CATALOG_IMPORT_BYTES) {
        throw new UserInputError('导入文件不能超过 20MB');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.source.fileHash)) {
        throw new UserInputError('文件摘要格式无效');
    }
    if (!/\.(numbers|xlsx|xls|csv)$/i.test(input.source.filename)) {
        throw new UserInputError('仅支持 .numbers、.xlsx、.xls 或 .csv 文件');
    }
    if (!/^catalog-browser-v\d+$/u.test(input.source.parserVersion)) {
        throw new UserInputError('浏览器解析器版本无效');
    }
    if (input.source.detectedHeaders.length < 1 || input.source.detectedHeaders.length > 100) {
        throw new UserInputError('表头数量无效');
    }
    const unresolvedHeaders = input.source.detectedHeaders.filter(header => {
        const mapped = input.source.fieldMapping[header];
        return !mapped || mapped === '__unknown__';
    });
    if (unresolvedHeaders.length > 0) {
        throw new UserInputError(`存在未解决列：${unresolvedHeaders.join('、')}`);
    }
    const allowedMappings = new Set([
        'name',
        'category',
        'channelCode',
        'stockLocationCode',
        'currencyCode',
        'specification',
        'primaryUnit',
        'purchaseUnit',
        'packageQuantity',
        'stockOnHand',
        'purchaseCost',
        'sellingPrice',
        'reportedMargin',
        'maximumStock',
        'minimumStock',
        'brand',
        'manufacturedAt',
        'shelfLifeDays',
        'enabled',
        'variantEnabled',
        'description',
        'tags',
        'sourceCreatedAt',
        'sku',
        'barcode',
        'lotCode',
        'lotQuantity',
        'supplier',
        '__excluded__',
    ]);
    if (Object.values(input.source.fieldMapping).some(mapping => !allowedMappings.has(mapping))) {
        throw new UserInputError('字段映射包含不支持的系统字段');
    }
}

export function sanitizeCatalogRow(row: NormalizedCatalogRow, expectedRows: number): NormalizedCatalogRow {
    if (!Number.isInteger(row.rowNumber) || row.rowNumber < 2 || row.rowNumber > expectedRows + 1) {
        throw new UserInputError('商品行号超出导入范围');
    }
    const name = safeRequiredRowText(row.name, 255, row.rowNumber, '名称');
    const category = safeImportText(row.category, 255);
    const purchaseCost = finiteRowNumber(row.purchaseCost, row.rowNumber, '进货价', false);
    const sellingPrice = finiteRowNumber(row.sellingPrice, row.rowNumber, '销售价', true);
    if (purchaseCost != null && purchaseCost < 0) {
        throw new UserInputError(`第 ${row.rowNumber} 行：进货价不能为负数`);
    }
    if (sellingPrice < 0) throw new UserInputError(`第 ${row.rowNumber} 行：销售价不能为负数`);
    if (row.shelfLifeDays != null && (!Number.isInteger(row.shelfLifeDays) || row.shelfLifeDays < 0)) {
        throw new UserInputError(`第 ${row.rowNumber} 行：保质期必须是非负整数`);
    }
    if (row.lotQuantity != null && row.lotQuantity < 0) {
        throw new UserInputError(`第 ${row.rowNumber} 行：批次数量不能为负数`);
    }
    if (!Number.isFinite(row.packageQuantity) || row.packageQuantity <= 0) {
        throw new UserInputError(`第 ${row.rowNumber} 行：包装换算必须大于 0`);
    }
    for (const [value, label] of [
        [row.stockOnHand, '库存量'],
        [row.minimumStock, '库存下限'],
        [row.maximumStock, '库存上限'],
        [row.lotQuantity, '批次数量'],
    ] as const) {
        if (value != null && !Number.isInteger(value)) {
            throw new UserInputError(`第 ${row.rowNumber} 行：${label}必须是整数`);
        }
    }
    const normalizedDate = (value: string | null, label: string) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) {
            throw new UserInputError(`第 ${row.rowNumber} 行：${label}不是有效日期`);
        }
        return parsed.toISOString();
    };
    const allowedFields = new Set([
        'name',
        'category',
        'channelCode',
        'stockLocationCode',
        'currencyCode',
        'specification',
        'primaryUnit',
        'purchaseUnit',
        'packageQuantity',
        'stockOnHand',
        'purchaseCost',
        'sellingPrice',
        'reportedMargin',
        'maximumStock',
        'minimumStock',
        'brand',
        'manufacturedAt',
        'shelfLifeDays',
        'enabled',
        'variantEnabled',
        'description',
        'tags',
        'sourceCreatedAt',
        'sku',
        'barcode',
        'lotCode',
        'lotQuantity',
        'supplier',
    ]);
    const providedFields = [...new Set((row.providedFields ?? []).filter(field => allowedFields.has(field)))];
    return {
        rowNumber: row.rowNumber,
        name,
        category,
        channelCode: safeImportText(row.channelCode, 255),
        stockLocationCode: safeImportText(row.stockLocationCode, 255),
        currencyCode: safeImportText(row.currencyCode, 3).toUpperCase(),
        specification: safeImportText(row.specification, 255),
        primaryUnit: safeImportText(row.primaryUnit, 80),
        purchaseUnit: safeImportText(row.purchaseUnit, 80),
        packageQuantity: row.packageQuantity,
        stockOnHand: row.stockOnHand,
        purchaseCost,
        sellingPrice,
        reportedMargin:
            row.reportedMargin == null
                ? null
                : finiteRowNumber(row.reportedMargin, row.rowNumber, '毛利率', false),
        maximumStock: row.maximumStock,
        minimumStock: row.minimumStock,
        brand: safeImportText(row.brand, 255),
        manufacturedAt: normalizedDate(row.manufacturedAt, '生产日期'),
        shelfLifeDays: row.shelfLifeDays,
        enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
        variantEnabled: typeof row.variantEnabled === 'boolean' ? row.variantEnabled : null,
        description: safeImportText(row.description, 50_000),
        tags: [...new Set((row.tags ?? []).map(tag => safeImportText(tag, 255)).filter(Boolean))].slice(
            0,
            100,
        ),
        sourceCreatedAt: normalizedDate(row.sourceCreatedAt, '创建日期'),
        sku: safeImportText(row.sku, 255),
        barcode: safeImportText(row.barcode, 255),
        lotCode: safeImportText(row.lotCode, 80),
        lotQuantity: row.lotQuantity,
        supplier: normalizeSupplierDisplayName(safeImportText(row.supplier, 255)),
        providedFields,
    };
}

export function effectiveVariantEnabled(row: NormalizedCatalogRow): boolean | null {
    return typeof row.variantEnabled === 'boolean' ? row.variantEnabled : row.enabled;
}

export function finiteRowNumber(
    value: number | null,
    rowNumber: number,
    label: string,
    required: true,
): number;
export function finiteRowNumber(
    value: number | null,
    rowNumber: number,
    label: string,
    required: false,
): number | null;
export function finiteRowNumber(
    value: number | null,
    rowNumber: number,
    label: string,
    required: boolean,
): number | null {
    if (value == null) {
        if (required) throw new UserInputError(`第 ${rowNumber} 行：${label}不能为空`);
        return null;
    }
    if (!Number.isFinite(value)) throw new UserInputError(`第 ${rowNumber} 行：${label}不是有效数字`);
    return value;
}

export function safeRequiredRowText(
    value: string,
    maxLength: number,
    rowNumber: number,
    label: string,
): string {
    const normalized = safeImportText(value, maxLength);
    if (!normalized) throw new UserInputError(`第 ${rowNumber} 行：${label}不能为空`);
    return normalized;
}

export function safeImportText(value: string, maxLength: number): string {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/\0/gu, '')
        .trim()
        .slice(0, maxLength);
}

export function safeImportFilename(filename: string): string {
    return safeImportText(filename.replace(/[\\/]/gu, '_'), 255) || 'catalog-import.xlsx';
}

export function sanitizeFieldMapping(value: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(value ?? {})
            .slice(0, 100)
            .map(([header, field]) => [safeImportText(header, 255), safeImportText(field, 80)])
            .filter(([header, field]) => Boolean(header && field)),
    );
}
