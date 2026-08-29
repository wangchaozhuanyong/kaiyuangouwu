import { Injectable } from '@nestjs/common';
import { UserInputError } from '@vendure/core';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';

import { MAX_CATALOG_IMPORT_BYTES, MAX_CATALOG_IMPORT_ROWS } from './constants';
import { NormalizedCatalogRow, UploadedCatalogFile } from './types';

type CellValue = string | number | boolean | Date | null | undefined;

const headerAliases: Record<string, keyof NormalizedCatalogRow> = {
    名称: 'name',
    商品名称: 'name',
    分类: 'category',
    商品分类: 'category',
    门店: 'channelCode',
    门店编码: 'channelCode',
    仓库: 'stockLocationCode',
    仓库编码: 'stockLocationCode',
    币种: 'currencyCode',
    规格: 'specification',
    主单位: 'primaryUnit',
    单位: 'primaryUnit',
    销售单位: 'primaryUnit',
    采购单位: 'purchaseUnit',
    包装换算: 'packageQuantity',
    包装换算数量: 'packageQuantity',
    库存量: 'stockOnHand',
    库存: 'stockOnHand',
    进货价: 'purchaseCost',
    成本价: 'purchaseCost',
    销售价: 'sellingPrice',
    售价: 'sellingPrice',
    毛利率: 'reportedMargin',
    库存上限: 'maximumStock',
    库存下限: 'minimumStock',
    品牌: 'brand',
    生产日期: 'manufacturedAt',
    保质期: 'shelfLifeDays',
    保质期天数: 'shelfLifeDays',
    商品状态: 'enabled',
    状态: 'enabled',
    商品描述: 'description',
    描述: 'description',
    标签: 'tags',
    创建日期: 'sourceCreatedAt',
    SKU: 'sku',
    商品编码: 'sku',
    条码: 'barcode',
    批次号: 'lotCode',
    批次数量: 'lotQuantity',
};

const requiredFields: Array<keyof NormalizedCatalogRow> = [
    'name',
    'category',
    'purchaseCost',
    'sellingPrice',
];

export interface ParsedCatalogFile {
    fileHash: string;
    byteSize: number;
    sheetName: string;
    rows: NormalizedCatalogRow[];
    errors: ParsedCatalogRowError[];
    headers: string[];
    fieldMapping: Record<string, string>;
}

export interface ParsedCatalogRowError {
    rowNumber: number;
    errorKey: string;
    message: string;
    normalizedData: NormalizedCatalogRow;
}

@Injectable()
export class CatalogFileParserService {
    async parseUpload(filePromise: Promise<UploadedCatalogFile>): Promise<ParsedCatalogFile> {
        const file = await filePromise;
        const filename = safeFilename(file.filename);
        assertSupportedExtension(filename);
        const buffer = await readBoundedStream(file.createReadStream(), MAX_CATALOG_IMPORT_BYTES);
        return this.parseBuffer(buffer, filename);
    }

    parseBuffer(buffer: Buffer, filename: string): ParsedCatalogFile {
        if (buffer.length === 0) throw new UserInputError('导入文件为空');
        if (buffer.length > MAX_CATALOG_IMPORT_BYTES) throw new UserInputError('导入文件不能超过 20MB');
        assertSupportedExtension(filename);

        let workbook: XLSX.WorkBook;
        try {
            workbook = XLSX.read(buffer, {
                type: 'buffer',
                cellDates: true,
                cellFormula: false,
                cellHTML: false,
                cellStyles: false,
                dense: true,
                WTF: false,
            });
        } catch {
            throw new UserInputError('无法解析文件，请确认文件是有效的 Numbers、Excel 或 CSV 文件');
        }
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new UserInputError('文件中没有可读取的工作表');
        const sheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
            header: 1,
            raw: true,
            blankrows: false,
            defval: null,
        });
        if (matrix.length < 2) throw new UserInputError('工作表没有商品数据');
        if (matrix.length - 1 > MAX_CATALOG_IMPORT_ROWS) {
            throw new UserInputError(`单次最多导入 ${MAX_CATALOG_IMPORT_ROWS} 行商品`);
        }

        const headers = matrix[0].map(value => normalizeHeader(value));
        const columnFields = headers.map(header => headerAliases[header]);
        const missing = requiredFields.filter(field => !columnFields.includes(field));
        if (missing.length > 0) {
            throw new UserInputError(`缺少必填列：${missing.map(displayField).join('、')}`);
        }
        const duplicateHeaders = headers.filter(
            (header, index) => header && headers.indexOf(header) !== index,
        );
        if (duplicateHeaders.length > 0) {
            throw new UserInputError(`存在重复列：${[...new Set(duplicateHeaders)].join('、')}`);
        }

        const rows: NormalizedCatalogRow[] = [];
        const errors: ParsedCatalogRowError[] = [];
        matrix.slice(1).forEach((cells, index) => {
            const rowNumber = index + 2;
            try {
                rows.push(normalizeRow(cells, columnFields, rowNumber));
            } catch (error) {
                const normalizedData = invalidRow(cells, columnFields, rowNumber);
                errors.push({
                    rowNumber,
                    errorKey: sha256(`invalid\u001f${rowNumber}\u001f${JSON.stringify(normalizedData.raw)}`),
                    message: error instanceof Error ? error.message : `第 ${rowNumber} 行：无法解析`,
                    normalizedData,
                });
            }
        });
        return {
            fileHash: sha256(buffer),
            byteSize: buffer.length,
            sheetName,
            rows,
            errors,
            headers,
            fieldMapping: Object.fromEntries(
                headers.flatMap((header, index) => {
                    const field = columnFields[index];
                    return header && field ? [[header, String(field)]] : [];
                }),
            ),
        };
    }
}

export function catalogProductKey(row: Pick<NormalizedCatalogRow, 'name' | 'category'>): string {
    return sha256(`${normalizeIdentity(row.name)}\u001f${normalizeIdentity(row.category)}`);
}

export function catalogSourceKey(
    row: Pick<
        NormalizedCatalogRow,
        | 'name'
        | 'category'
        | 'specification'
        | 'primaryUnit'
        | 'sku'
        | 'barcode'
        | 'stockLocationCode'
        | 'lotCode'
    >,
): string {
    const base = row.sku
        ? `sku\u001f${normalizeIdentity(row.sku)}`
        : row.barcode
          ? `barcode\u001f${normalizeIdentity(row.barcode)}`
          : [row.name, row.category, row.specification, row.primaryUnit]
                .map(normalizeIdentity)
                .join('\u001f');
    const inventoryScope = [row.stockLocationCode, row.lotCode]
        .map(normalizeIdentity)
        .filter(Boolean)
        .join('\u001f');
    return sha256(inventoryScope ? `${base}\u001finventory\u001f${inventoryScope}` : base);
}

export function catalogRowFingerprint(row: NormalizedCatalogRow): string {
    const { rowNumber: _rowNumber, raw: _raw, reportedMargin: _reportedMargin, ...stable } = row;
    return sha256(JSON.stringify(stable));
}

export function normalizeIdentity(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-Hans');
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
    if (!name) throw new UserInputError(`第 ${rowNumber} 行：名称不能为空`);
    if (!category) throw new UserInputError(`第 ${rowNumber} 行：分类不能为空`);

    const purchaseCost = decimalValue(values.get('purchaseCost'), rowNumber, '进货价', true);
    const sellingPrice = decimalValue(values.get('sellingPrice'), rowNumber, '销售价', true);
    const stockOnHand = integerValue(values.get('stockOnHand'), rowNumber, '库存量');
    const maximumStock = integerValue(values.get('maximumStock'), rowNumber, '库存上限');
    const minimumStock = integerValue(values.get('minimumStock'), rowNumber, '库存下限');
    const shelfLifeDays = integerValue(values.get('shelfLifeDays'), rowNumber, '保质期');
    const lotQuantity = integerValue(values.get('lotQuantity'), rowNumber, '批次数量');
    const packageQuantity = decimalValue(values.get('packageQuantity'), rowNumber, '包装换算') ?? 1;
    if (purchaseCost != null && purchaseCost < 0) {
        throw new UserInputError(`第 ${rowNumber} 行：进货价不能为负数`);
    }
    if (sellingPrice != null && sellingPrice < 0) {
        throw new UserInputError(`第 ${rowNumber} 行：销售价不能为负数`);
    }
    if (shelfLifeDays != null && shelfLifeDays < 0) {
        throw new UserInputError(`第 ${rowNumber} 行：保质期不能为负数`);
    }
    if (lotQuantity != null && lotQuantity < 0) {
        throw new UserInputError(`第 ${rowNumber} 行：批次数量不能为负数`);
    }
    if (packageQuantity <= 0) throw new UserInputError(`第 ${rowNumber} 行：包装换算必须大于 0`);

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
        channelCode: textValue(values.get('channelCode')),
        stockLocationCode: textValue(values.get('stockLocationCode')),
        currencyCode: textValue(values.get('currencyCode')).toUpperCase(),
        specification: textValue(values.get('specification')),
        primaryUnit: textValue(values.get('primaryUnit')),
        purchaseUnit: textValue(values.get('purchaseUnit')),
        packageQuantity,
        stockOnHand,
        purchaseCost,
        sellingPrice,
        reportedMargin: marginValue(values.get('reportedMargin'), rowNumber),
        maximumStock,
        minimumStock,
        brand: textValue(values.get('brand')),
        manufacturedAt: dateValue(values.get('manufacturedAt'), rowNumber, '生产日期'),
        shelfLifeDays,
        enabled: statusValue(values.get('enabled'), rowNumber),
        description: textValue(values.get('description')),
        tags: textValue(values.get('tags'))
            .split(/[，,；;、]/)
            .map(value => value.trim())
            .filter(Boolean),
        sourceCreatedAt: dateValue(values.get('sourceCreatedAt'), rowNumber, '创建日期'),
        sku: textValue(values.get('sku')),
        barcode: textValue(values.get('barcode')),
        lotCode: textValue(values.get('lotCode')),
        lotQuantity,
        providedFields: [...values.keys()].map(String),
        raw,
    };
}

function invalidRow(
    cells: CellValue[],
    fields: Array<keyof NormalizedCatalogRow | undefined>,
    rowNumber: number,
): NormalizedCatalogRow {
    const raw: Record<string, string | number | boolean | null> = {};
    fields.forEach((field, index) => {
        if (!field) return;
        const value = cells[index];
        raw[String(field)] = value instanceof Date ? value.toISOString() : (value ?? null);
    });
    return {
        rowNumber,
        name: textValue(cells[fields.indexOf('name')]),
        category: textValue(cells[fields.indexOf('category')]),
        channelCode: textValue(cells[fields.indexOf('channelCode')]),
        stockLocationCode: textValue(cells[fields.indexOf('stockLocationCode')]),
        currencyCode: textValue(cells[fields.indexOf('currencyCode')]).toUpperCase(),
        specification: textValue(cells[fields.indexOf('specification')]),
        primaryUnit: textValue(cells[fields.indexOf('primaryUnit')]),
        purchaseUnit: textValue(cells[fields.indexOf('purchaseUnit')]),
        packageQuantity: 1,
        stockOnHand: null,
        purchaseCost: null,
        sellingPrice: null,
        reportedMargin: null,
        maximumStock: null,
        minimumStock: null,
        brand: textValue(cells[fields.indexOf('brand')]),
        manufacturedAt: null,
        shelfLifeDays: null,
        enabled: null,
        description: textValue(cells[fields.indexOf('description')]),
        tags: [],
        sourceCreatedAt: null,
        sku: textValue(cells[fields.indexOf('sku')]),
        barcode: textValue(cells[fields.indexOf('barcode')]),
        lotCode: textValue(cells[fields.indexOf('lotCode')]),
        lotQuantity: null,
        providedFields: fields
            .filter((field): field is keyof NormalizedCatalogRow => Boolean(field))
            .map(String),
        raw,
    };
}

function normalizeHeader(value: CellValue): string {
    return textValue(value)
        .replace(/[（(]必填[）)]/g, '')
        .replace(/\s+/g, '');
}

function textValue(value: CellValue): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value).normalize('NFKC').trim();
}

function decimalValue(value: CellValue, row: number, label: string, required = false): number | null {
    const text = textValue(value).replace(/[￥¥,$\s]/g, '');
    if (!text) {
        if (required) throw new UserInputError(`第 ${row} 行：${label}不能为空`);
        return null;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) throw new UserInputError(`第 ${row} 行：${label}不是有效数字`);
    return parsed;
}

function integerValue(value: CellValue, row: number, label: string): number | null {
    const decimal = decimalValue(value, row, label);
    if (decimal == null) return null;
    if (!Number.isInteger(decimal)) throw new UserInputError(`第 ${row} 行：${label}必须是整数`);
    return decimal;
}

function marginValue(value: CellValue, row: number): number | null {
    const text = textValue(value);
    if (!text) return null;
    const percent = text.endsWith('%');
    const parsed = Number(text.replace('%', ''));
    if (!Number.isFinite(parsed)) throw new UserInputError(`第 ${row} 行：毛利率不是有效数字`);
    if (percent) return parsed / 100;
    return Math.abs(parsed) <= 1 ? parsed : parsed / 100;
}

function dateValue(value: CellValue, row: number, label: string): string | null {
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
    const date = new Date(textValue(value).replace(/\./g, '-').replace(/\//g, '-'));
    if (!Number.isFinite(date.getTime())) throw new UserInputError(`第 ${row} 行：${label}不是有效日期`);
    return date.toISOString();
}

function statusValue(value: CellValue, row: number): boolean | null {
    const status = normalizeIdentity(textValue(value));
    if (!status) return null;
    if (['启用', '上架', '是', 'true', '1', 'enabled'].includes(status)) return true;
    if (['禁用', '停用', '下架', '否', 'false', '0', 'disabled'].includes(status)) return false;
    throw new UserInputError(`第 ${row} 行：商品状态只支持启用或禁用`);
}

function displayField(field: keyof NormalizedCatalogRow): string {
    const labels: Partial<Record<keyof NormalizedCatalogRow, string>> = {
        name: '名称',
        category: '分类',
        purchaseCost: '进货价',
        sellingPrice: '销售价',
    };
    return labels[field] ?? String(field);
}

function assertSupportedExtension(filename: string): void {
    if (!/\.(numbers|xlsx|xls|csv)$/i.test(filename)) {
        throw new UserInputError('仅支持 .numbers、.xlsx、.xls 或 .csv 文件');
    }
}

function safeFilename(filename: string): string {
    return filename.replace(/[\\/\0]/g, '_').slice(0, 255) || 'catalog-import.xlsx';
}

function sha256(value: Buffer | string): string {
    return createHash('sha256').update(value).digest('hex');
}

async function readBoundedStream(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    try {
        for await (const chunk of stream as AsyncIterable<Buffer | string>) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > maxBytes) {
                if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
                throw new UserInputError('导入文件不能超过 20MB');
            }
            chunks.push(buffer);
        }
    } catch (error) {
        if (error instanceof UserInputError) throw error;
        throw new UserInputError('读取上传文件失败');
    }
    return Buffer.concat(chunks);
}
