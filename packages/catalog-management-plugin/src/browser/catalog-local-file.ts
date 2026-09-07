import * as XLSX from 'xlsx';

import {
    CATALOG_EXCLUDED_HEADERS,
    CATALOG_FIELD_OPTIONS,
    CATALOG_HEADER_ALIASES,
    CATALOG_REQUIRED_FIELDS,
    catalogFieldLabel,
} from '../catalog-field-definitions';
import {
    catalogCategoryPath,
    parseCatalogFulfillmentType,
    validateCatalogCategories,
} from '../catalog-import-classification';
import { parseCatalogImportStore } from '../catalog-import-store';
import { assignCatalogSourceRecordKeys } from '../catalog-row-identity';
import { type NormalizedCatalogRow } from '../types';

export { CATALOG_EXCLUDED_HEADERS, CATALOG_FIELD_OPTIONS } from '../catalog-field-definitions';

type CellValue = string | number | boolean | Date | null | undefined;

export const CATALOG_BROWSER_PARSER_VERSION = 'catalog-browser-v4';
export const MAX_LOCAL_CATALOG_BYTES = 20 * 1024 * 1024;
export const MAX_LOCAL_CATALOG_ROWS = 20_000;
export const CATALOG_MAPPING_EXCLUDED = '__excluded__';
export const CATALOG_MAPPING_UNKNOWN = '__unknown__';

const importableFields = new Set<keyof NormalizedCatalogRow>(
    CATALOG_FIELD_OPTIONS.map(option => option.value),
);

export interface LocalCatalogRowError {
    rowNumber: number;
    message: string;
}

export interface LocalCatalogFile {
    filename: string;
    mimetype: string;
    byteSize: number;
    fileHash: string;
    sheetName: string;
    headers: string[];
    fieldMapping: Record<string, string>;
    rows: NormalizedCatalogRow[];
    errors: LocalCatalogRowError[];
    duplicateGroups: number;
    duplicateRows: number;
    multiSkuGroups: number;
    multiSkuRows: number;
    exactDuplicateRows: number;
    warningRows: number;
    mappedHeaders: number;
    excludedHeaders: string[];
    unknownHeaders: string[];
}

export interface CatalogWorkerRequest {
    filename: string;
    mimetype: string;
    buffer: ArrayBuffer;
    fieldMapping?: Record<string, string>;
}

export type CatalogWorkerResponse = { ok: true; result: LocalCatalogFile } | { ok: false; message: string };

export async function parseCatalogArrayBuffer(
    buffer: ArrayBuffer,
    filename: string,
    mimetype = 'application/octet-stream',
    fieldMappingOverrides?: Record<string, string>,
): Promise<LocalCatalogFile> {
    assertLocalFile(filename, buffer.byteLength);
    let workbook: XLSX.WorkBook;
    try {
        workbook = readCatalogWorkbook(buffer, filename);
    } catch {
        throw new Error('无法解析文件，请确认文件是有效的 Numbers、Excel 或 CSV 文件');
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('文件中没有可读取的工作表');
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
        header: 1,
        raw: true,
        blankrows: false,
        defval: null,
    });
    if (matrix.length < 2) throw new Error('工作表没有商品数据');
    if (matrix.length - 1 > MAX_LOCAL_CATALOG_ROWS) {
        throw new Error(`单次最多导入 ${MAX_LOCAL_CATALOG_ROWS} 行商品`);
    }

    const headers = matrix[0].map(normalizeHeader);
    const mappingStatuses = headers.map(header => {
        if (fieldMappingOverrides && Object.prototype.hasOwnProperty.call(fieldMappingOverrides, header)) {
            const override = fieldMappingOverrides[header];
            if (override && importableFields.has(override as keyof NormalizedCatalogRow)) {
                return { field: override as keyof NormalizedCatalogRow, status: 'MAPPED' as const };
            }
            if (override === CATALOG_MAPPING_EXCLUDED) {
                return { field: undefined, status: 'EXCLUDED' as const };
            }
            return { field: undefined, status: 'UNKNOWN' as const };
        }
        const field = CATALOG_HEADER_ALIASES[header];
        if (field) return { field, status: 'MAPPED' as const };
        if (CATALOG_EXCLUDED_HEADERS.has(header)) {
            return { field: undefined, status: 'EXCLUDED' as const };
        }
        return { field: undefined, status: 'UNKNOWN' as const };
    });
    const columnFields = mappingStatuses.map(item => item.field);
    const missing = CATALOG_REQUIRED_FIELDS.filter(field => !columnFields.includes(field));
    if (missing.length > 0) {
        throw new Error(`缺少必填列：${missing.map(displayField).join('、')}`);
    }
    const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
    if (duplicates.length > 0) {
        throw new Error(`存在重复列：${[...new Set(duplicates)].join('、')}`);
    }
    const duplicateFields = columnFields.filter((field, index): field is keyof NormalizedCatalogRow =>
        Boolean(field && columnFields.indexOf(field) !== index),
    );
    if (duplicateFields.length > 0) {
        throw new Error(
            `多个列映射到同一字段：${[...new Set(duplicateFields)].map(displayField).join('、')}`,
        );
    }

    const productRows: NormalizedCatalogRow[] = [];
    const errors: LocalCatalogRowError[] = [];
    matrix.slice(1).forEach((cells, index) => {
        const rowNumber = index + 2;
        try {
            productRows.push(normalizeRow(cells, columnFields, rowNumber));
        } catch (error) {
            errors.push({
                rowNumber,
                message: error instanceof Error ? error.message : `第 ${rowNumber} 行：无法解析`,
            });
        }
    });
    const rows = assignCatalogSourceRecordKeys(expandStandardWorkbookRows(workbook, productRows));
    if (rows.length > MAX_LOCAL_CATALOG_ROWS) {
        throw new Error(`合并库存和批次后最多导入 ${MAX_LOCAL_CATALOG_ROWS} 行商品`);
    }
    const duplicateCounts = localDuplicateCounts(rows);
    return {
        filename: safeFilename(filename),
        mimetype: mimetype || 'application/octet-stream',
        byteSize: buffer.byteLength,
        fileHash: await sha256(buffer),
        sheetName,
        headers,
        fieldMapping: Object.fromEntries(
            headers.flatMap((header, index) => {
                if (!header) return [];
                const item = mappingStatuses[index];
                const value =
                    item.status === 'MAPPED'
                        ? String(item.field)
                        : item.status === 'EXCLUDED'
                          ? CATALOG_MAPPING_EXCLUDED
                          : CATALOG_MAPPING_UNKNOWN;
                return [[header, value]];
            }),
        ),
        rows,
        errors,
        ...duplicateCounts,
        warningRows: rows.filter(hasLocalWarning).length,
        mappedHeaders: mappingStatuses.filter(item => item.status === 'MAPPED').length,
        excludedHeaders: headers.filter((_, index) => mappingStatuses[index].status === 'EXCLUDED'),
        unknownHeaders: headers.filter((_, index) => mappingStatuses[index].status === 'UNKNOWN'),
    };
}

function readCatalogWorkbook(buffer: ArrayBuffer, filename: string): XLSX.WorkBook {
    const commonOptions = {
        cellDates: true,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        dense: true,
        WTF: false,
    } as const;
    const bytes = new Uint8Array(buffer);
    if (filename.trim().toLocaleLowerCase('en-US').endsWith('.csv')) {
        try {
            return XLSX.read(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
                ...commonOptions,
                type: 'string',
            });
        } catch {
            // Preserve SheetJS' legacy code-page handling for non-UTF-8 CSV files.
        }
    }
    return XLSX.read(bytes, {
        ...commonOptions,
        type: 'array',
    });
}

interface StandardStockRow {
    sku: string;
    stockLocationCode: string;
    stockOnHand: number;
    minimumStock: number | null;
    maximumStock: number | null;
}

interface StandardLotRow {
    sku: string;
    stockLocationCode: string;
    lotCode: string;
    manufacturedAt: string | null;
    expiresAt: string | null;
    quantityOnHand: number;
}

function expandStandardWorkbookRows(
    workbook: XLSX.WorkBook,
    productRows: NormalizedCatalogRow[],
): NormalizedCatalogRow[] {
    const stockSheet = workbook.Sheets['库存策略'];
    const lotSheet = workbook.Sheets['批次效期'];
    if (!stockSheet && !lotSheet) return productRows;

    const stocks = inventoryBySku(stockSheet ? parseStandardStockRows(stockSheet) : []);
    const lots = inventoryBySku(lotSheet ? parseStandardLotRows(lotSheet) : []);
    const skuCounts = new Map<string, number>();
    for (const row of productRows) {
        const sku = normalizeIdentity(row.sku);
        if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    }
    const expanded = productRows.flatMap(product => {
        const sku = normalizeIdentity(product.sku);
        if (!sku || skuCounts.get(sku) !== 1) return [product];
        const productStocks = stocks.get(sku) ?? [];
        const productLots = lots.get(sku) ?? [];
        if (productStocks.length === 0 && productLots.length === 0) return [product];

        const rows: NormalizedCatalogRow[] = [];
        const lotWarehouses = new Set<string>();
        for (const lot of productLots) {
            const warehouseKey = normalizeIdentity(lot.stockLocationCode);
            const stock = productStocks.find(
                item => normalizeIdentity(item.stockLocationCode) === warehouseKey,
            );
            lotWarehouses.add(warehouseKey);
            rows.push(
                mergeStandardInventory(product, stock, lot, [
                    'stockLocationCode',
                    'stockOnHand',
                    'minimumStock',
                    'maximumStock',
                    'lotCode',
                    'lotQuantity',
                    'manufacturedAt',
                    'shelfLifeDays',
                ]),
            );
        }
        for (const stock of productStocks) {
            if (lotWarehouses.has(normalizeIdentity(stock.stockLocationCode))) continue;
            rows.push(
                mergeStandardInventory(product, stock, undefined, [
                    'stockLocationCode',
                    'stockOnHand',
                    'minimumStock',
                    'maximumStock',
                ]),
            );
        }
        if (
            product.stockLocationCode &&
            !rows.some(
                row =>
                    normalizeIdentity(row.stockLocationCode) === normalizeIdentity(product.stockLocationCode),
            )
        ) {
            rows.push(product);
        }
        return rows.length > 0 ? rows : [product];
    });
    return expanded.map((row, index) => ({ ...row, rowNumber: index + 2 }));
}

function inventoryBySku<T extends { sku: string }>(rows: T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const key = normalizeIdentity(row.sku);
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
    }
    return groups;
}

function parseStandardStockRows(sheet: XLSX.WorkSheet): StandardStockRow[] {
    return standardSheetRecords(sheet).flatMap((record, index) => {
        const sku = importSafeTextValue(record.get('SKU'));
        if (!sku) return [];
        const stockOnHand = integerValue(record.get('库存量'), index + 2, '库存量');
        if (stockOnHand == null) throw new Error(`库存策略第 ${index + 2} 行：库存量不能为空`);
        return [
            {
                sku,
                stockLocationCode: textValue(record.get('仓库')),
                stockOnHand,
                minimumStock: integerValue(record.get('库存下限'), index + 2, '库存下限'),
                maximumStock: integerValue(record.get('库存上限'), index + 2, '库存上限'),
            },
        ];
    });
}

function parseStandardLotRows(sheet: XLSX.WorkSheet): StandardLotRow[] {
    return standardSheetRecords(sheet).flatMap((record, index) => {
        const sku = importSafeTextValue(record.get('SKU'));
        if (!sku) return [];
        const quantity = integerValue(record.get('批次数量'), index + 2, '批次数量');
        if (quantity == null) throw new Error(`批次效期第 ${index + 2} 行：批次数量不能为空`);
        return [
            {
                sku,
                stockLocationCode: textValue(record.get('仓库')),
                lotCode: importSafeTextValue(record.get('批次号')),
                manufacturedAt: dateValue(record.get('生产日期'), index + 2, '生产日期'),
                expiresAt: dateValue(record.get('到期日期'), index + 2, '到期日期'),
                quantityOnHand: quantity,
            },
        ];
    });
}

function standardSheetRecords(sheet: XLSX.WorkSheet): Array<Map<string, CellValue>> {
    const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
        header: 1,
        raw: true,
        blankrows: false,
        defval: null,
    });
    if (matrix.length === 0) return [];
    const headers = matrix[0].map(normalizeHeader);
    return matrix.slice(1).map(cells => new Map(headers.map((header, index) => [header, cells[index]])));
}

function mergeStandardInventory(
    product: NormalizedCatalogRow,
    stock: StandardStockRow | undefined,
    lot: StandardLotRow | undefined,
    providedFields: string[],
): NormalizedCatalogRow {
    const stockLocationCode = lot?.stockLocationCode || stock?.stockLocationCode || product.stockLocationCode;
    const isMainWarehouse =
        Boolean(product.stockLocationCode) &&
        normalizeIdentity(stockLocationCode) === normalizeIdentity(product.stockLocationCode);
    // The maintenance sheet owns its warehouse values, including explicit blank cells.
    const inventoryValue = (
        field: 'stockOnHand' | 'minimumStock' | 'maximumStock',
        detail: number | null | undefined,
    ): number | null =>
        isMainWarehouse && product.providedFields.includes(field)
            ? product[field]
            : (detail ?? (isMainWarehouse || !product.stockLocationCode ? product[field] : null));
    const shelfLifeDays =
        lot?.manufacturedAt && lot.expiresAt
            ? Math.max(
                  0,
                  Math.round(
                      (new Date(lot.expiresAt).getTime() - new Date(lot.manufacturedAt).getTime()) /
                          86_400_000,
                  ),
              )
            : product.shelfLifeDays;
    return {
        ...product,
        stockLocationCode,
        stockOnHand: inventoryValue('stockOnHand', stock?.stockOnHand ?? lot?.quantityOnHand),
        minimumStock: inventoryValue('minimumStock', stock?.minimumStock),
        maximumStock: inventoryValue('maximumStock', stock?.maximumStock),
        lotCode: lot?.lotCode ?? product.lotCode,
        lotQuantity: lot?.quantityOnHand ?? product.lotQuantity,
        manufacturedAt: lot?.manufacturedAt ?? product.manufacturedAt,
        shelfLifeDays,
        providedFields: [...new Set([...product.providedFields, ...providedFields])],
    };
}

export function rowsForCatalogTransport(rows: NormalizedCatalogRow[]): NormalizedCatalogRow[] {
    return rows.map(({ raw: _raw, ...row }) => row);
}

function normalizeRow(
    cells: CellValue[],
    fields: Array<keyof NormalizedCatalogRow | undefined>,
    rowNumber: number,
): NormalizedCatalogRow {
    const values = new Map<keyof NormalizedCatalogRow, CellValue>();
    fields.forEach((field, index) => {
        if (field) values.set(field, cells[index]);
    });
    const name = textValue(values.get('name'));
    const category = textValue(values.get('category'));
    const secondaryCategory = textValue(values.get('secondaryCategory'));
    const fulfillmentType = parseCatalogFulfillmentType(values.get('fulfillmentType'), rowNumber);
    validateCatalogCategories(category, secondaryCategory, rowNumber);
    const sku = importSafeTextValue(values.get('sku'));
    const barcode = importSafeTextValue(values.get('barcode'));
    if (!name && !sku && !barcode) {
        throw new Error(`第 ${rowNumber} 行：名称为空时必须提供 SKU 或条码`);
    }
    const purchaseCost = decimalValue(values.get('purchaseCost'), rowNumber, '进货价');
    const sellingPrice = decimalValue(values.get('sellingPrice'), rowNumber, '销售价');
    const shelfLifeDays = integerValue(values.get('shelfLifeDays'), rowNumber, '保质期');
    const lotQuantity = integerValue(values.get('lotQuantity'), rowNumber, '批次数量');
    const packageQuantity = decimalValue(values.get('packageQuantity'), rowNumber, '包装换算');
    if (purchaseCost != null && purchaseCost < 0) {
        throw new Error(`第 ${rowNumber} 行：进货价不能为负数`);
    }
    if (sellingPrice != null && sellingPrice < 0) throw new Error(`第 ${rowNumber} 行：销售价不能为负数`);
    if (shelfLifeDays != null && shelfLifeDays < 0) {
        throw new Error(`第 ${rowNumber} 行：保质期不能为负数`);
    }
    if (lotQuantity != null && lotQuantity < 0) {
        throw new Error(`第 ${rowNumber} 行：批次数量不能为负数`);
    }
    if (packageQuantity != null && packageQuantity <= 0) {
        throw new Error(`第 ${rowNumber} 行：包装换算必须大于 0`);
    }
    const raw: Record<string, string | number | boolean | null> = {};
    fields.forEach((field, index) => {
        if (!field) return;
        const value = cells[index];
        raw[String(field)] = value instanceof Date ? value.toISOString() : (value ?? null);
    });
    return {
        rowNumber,
        name,
        category,
        secondaryCategory,
        fulfillmentType,
        channelCode: parseCatalogImportStore(importSafeTextValue(values.get('channelCode')), rowNumber),
        stockLocationCode: textValue(values.get('stockLocationCode')),
        currencyCode: textValue(values.get('currencyCode')).toUpperCase(),
        specification: textValue(values.get('specification')),
        primaryUnit: textValue(values.get('primaryUnit')),
        purchaseUnit: textValue(values.get('purchaseUnit')),
        packageQuantity,
        stockOnHand: integerValue(values.get('stockOnHand'), rowNumber, '库存量'),
        purchaseCost,
        sellingPrice,
        reportedMargin: marginValue(values.get('reportedMargin'), rowNumber),
        maximumStock: integerValue(values.get('maximumStock'), rowNumber, '库存上限'),
        minimumStock: integerValue(values.get('minimumStock'), rowNumber, '库存下限'),
        brand: textValue(values.get('brand')),
        manufacturedAt: dateValue(values.get('manufacturedAt'), rowNumber, '生产日期'),
        shelfLifeDays,
        enabled: statusValue(values.get('enabled'), rowNumber),
        variantEnabled: statusValue(values.get('variantEnabled'), rowNumber, 'SKU 状态'),
        description: textValue(values.get('description')),
        tags: textValue(values.get('tags'))
            .split(/[，,；;、]/u)
            .map(value => value.trim())
            .filter(Boolean),
        sourceCreatedAt: dateValue(values.get('sourceCreatedAt'), rowNumber, '创建日期'),
        sku,
        barcode,
        lotCode: importSafeTextValue(values.get('lotCode')),
        lotQuantity,
        supplier: normalizeSupplier(importSafeTextValue(values.get('supplier'))),
        providedFields: [...values.keys()].map(String),
        raw,
    };
}

function localDuplicateCounts(rows: NormalizedCatalogRow[]) {
    const productGroups = new Map<string, NormalizedCatalogRow[]>();
    for (const row of rows) {
        const key = localProductIdentity(row);
        productGroups.set(key, [...(productGroups.get(key) ?? []), row]);
    }
    const duplicateGroups: NormalizedCatalogRow[][] = [];
    const multiSkuGroups: NormalizedCatalogRow[][] = [];
    let exactDuplicateRows = 0;
    for (const productGroup of productGroups.values()) {
        if (productGroup.length < 2) continue;
        const inventoryGroups = new Map<string, NormalizedCatalogRow[]>();
        for (const row of productGroup) {
            const key = localIdentity(row);
            inventoryGroups.set(key, [...(inventoryGroups.get(key) ?? []), row]);
        }
        for (const group of inventoryGroups.values()) {
            const fingerprintCounts = new Map<string, number>();
            for (const row of group) {
                const fingerprint = stableRow(row);
                fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);
            }
            exactDuplicateRows += [...fingerprintCounts.values()].reduce(
                (total, count) => total + Math.max(0, count - 1),
                0,
            );
            if (fingerprintCounts.size > 1) {
                if (group[0]?.sku || group[0]?.barcode) duplicateGroups.push(group);
                else multiSkuGroups.push(group);
            }
        }
    }
    return {
        duplicateGroups: duplicateGroups.length,
        duplicateRows: duplicateGroups.reduce((total, group) => total + group.length, 0),
        multiSkuGroups: multiSkuGroups.length,
        multiSkuRows: multiSkuGroups.reduce((total, group) => total + group.length, 0),
        exactDuplicateRows,
    };
}

function localIdentity(row: NormalizedCatalogRow): string {
    const base = localProductIdentity(row);
    const inventoryScope = [row.stockLocationCode, row.lotCode]
        .map(normalizeIdentity)
        .filter(Boolean)
        .join('\u001f');
    return inventoryScope ? `${base}\u001finventory\u001f${inventoryScope}` : base;
}

function localProductIdentity(row: NormalizedCatalogRow): string {
    return row.sku
        ? `sku\u001f${normalizeIdentity(row.sku)}`
        : row.barcode
          ? `barcode\u001f${normalizeIdentity(row.barcode)}`
          : [row.name, catalogCategoryPath(row), row.specification, row.primaryUnit]
                .map(normalizeIdentity)
                .join('\u001f');
}

function stableRow(row: NormalizedCatalogRow): string {
    const { rowNumber: _rowNumber, sourceRecordKey: _sourceRecordKey, raw: _raw, ...stable } = row;
    return JSON.stringify(stable);
}

function hasLocalWarning(row: NormalizedCatalogRow): boolean {
    return Boolean(
        (row.stockOnHand != null && row.stockOnHand < 0) ||
        (row.purchaseCost != null && row.sellingPrice != null && row.sellingPrice < row.purchaseCost) ||
        (row.minimumStock != null && row.maximumStock != null && row.maximumStock < row.minimumStock),
    );
}

function normalizeHeader(value: CellValue): string {
    return textValue(value)
        .replace(/[（(]必填[）)]/gu, '')
        .replace(/\s+/gu, '');
}

function normalizeIdentity(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-Hans');
}

function normalizeSupplier(value: string): string {
    return ['', '-', '无', '无供应商', '无供货商', 'none', 'null'].includes(normalizeIdentity(value))
        ? ''
        : value;
}

function textValue(value: CellValue): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value).normalize('NFKC').trim();
}

function importSafeTextValue(value: CellValue): string {
    const text = textValue(value);
    return /^'[=+\-@]/u.test(text) ? text.slice(1) : text;
}

function decimalValue(value: CellValue, rowNumber: number, label: string, required: true): number;
function decimalValue(value: CellValue, rowNumber: number, label: string, required?: false): number | null;
function decimalValue(value: CellValue, rowNumber: number, label: string, required = false): number | null {
    const text = textValue(value).replace(/[￥¥,$\s]/gu, '');
    if (!text) {
        if (required) throw new Error(`第 ${rowNumber} 行：${label}不能为空`);
        return null;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) throw new Error(`第 ${rowNumber} 行：${label}不是有效数字`);
    return parsed;
}

function integerValue(value: CellValue, rowNumber: number, label: string): number | null {
    const number = decimalValue(value, rowNumber, label);
    if (number == null) return null;
    if (!Number.isInteger(number)) throw new Error(`第 ${rowNumber} 行：${label}必须是整数`);
    return number;
}

function marginValue(value: CellValue, rowNumber: number): number | null {
    const text = textValue(value);
    if (!text) return null;
    const percent = text.endsWith('%');
    const parsed = Number(text.replace('%', ''));
    if (!Number.isFinite(parsed)) throw new Error(`第 ${rowNumber} 行：毛利率不是有效数字`);
    return percent ? parsed / 100 : Math.abs(parsed) <= 1 ? parsed : parsed / 100;
}

function dateValue(value: CellValue, rowNumber: number, label: string): string | null {
    if (value == null || textValue(value) === '') return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    if (typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) {
            return new Date(
                Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S),
            ).toISOString();
        }
    }
    const date = new Date(textValue(value).replace(/\./gu, '-').replace(/\//gu, '-'));
    if (!Number.isFinite(date.getTime())) throw new Error(`第 ${rowNumber} 行：${label}不是有效日期`);
    return date.toISOString();
}

function statusValue(value: CellValue, rowNumber: number, label = '商品状态'): boolean | null {
    const status = normalizeIdentity(textValue(value));
    if (!status) return null;
    if (['启用', '上架', '是', 'true', '1', 'enabled'].includes(status)) return true;
    if (['禁用', '停用', '下架', '否', 'false', '0', 'disabled'].includes(status)) return false;
    throw new Error(`第 ${rowNumber} 行：${label}只支持启用或禁用`);
}

function displayField(field: keyof NormalizedCatalogRow): string {
    return catalogFieldLabel(field);
}

function assertLocalFile(filename: string, byteSize: number): void {
    if (!/\.(numbers|xlsx|xls|csv)$/i.test(filename)) {
        throw new Error('仅支持 .numbers、.xlsx、.xls 或 .csv 文件');
    }
    if (byteSize < 1) throw new Error('导入文件为空');
    if (byteSize > MAX_LOCAL_CATALOG_BYTES) throw new Error('导入文件不能超过 20MB');
}

function safeFilename(filename: string): string {
    return filename.replace(/[\\/\0]/gu, '_').slice(0, 255) || 'catalog-import.xlsx';
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
