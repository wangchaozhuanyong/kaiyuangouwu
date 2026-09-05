import * as XLSX from 'xlsx';

type CellValue = string | number | boolean | Date | null | undefined;
type ExpenseField = 'orderCode' | 'carrierShippingCostMicrounits' | 'paymentFeeMicrounits' | 'note';

export const MAX_ORDER_EXPENSE_IMPORT_ROWS = 5_000;
const MAX_ORDER_EXPENSE_IMPORT_BYTES = 20 * 1024 * 1024;

const headerAliases = new Map<string, ExpenseField>([
    ['订单号', 'orderCode'],
    ['订单编码', 'orderCode'],
    ['ordercode', 'orderCode'],
    ['实际物流成本', 'carrierShippingCostMicrounits'],
    ['承运商实际物流成本', 'carrierShippingCostMicrounits'],
    ['承运商成本', 'carrierShippingCostMicrounits'],
    ['物流成本', 'carrierShippingCostMicrounits'],
    ['carriershippingcost', 'carrierShippingCostMicrounits'],
    ['shippingcost', 'carrierShippingCostMicrounits'],
    ['支付手续费', 'paymentFeeMicrounits'],
    ['支付渠道手续费', 'paymentFeeMicrounits'],
    ['paymentfee', 'paymentFeeMicrounits'],
    ['备注', 'note'],
    ['note', 'note'],
]);

export interface OrderExpenseImportRow {
    rowNumber: number;
    orderCode: string;
    carrierShippingCostMicrounits?: number;
    paymentFeeMicrounits?: number;
    note?: string;
}

export interface OrderExpenseImportError {
    rowNumber: number;
    message: string;
}

export interface LocalOrderExpenseFile {
    filename: string;
    fileHash: string;
    sheetName: string;
    headers: string[];
    mappedHeaders: number;
    unknownHeaders: string[];
    sourceRowCount: number;
    rows: OrderExpenseImportRow[];
    errors: OrderExpenseImportError[];
}

export async function parseOrderExpenseArrayBuffer(
    buffer: ArrayBuffer,
    filename: string,
): Promise<LocalOrderExpenseFile> {
    assertExpenseFile(filename, buffer.byteLength);
    let workbook: XLSX.WorkBook;
    try {
        workbook = readWorkbook(buffer, filename);
    } catch {
        throw new Error('无法解析费用文件，请确认是有效的 Numbers、Excel 或 CSV 文件');
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('费用文件中没有可读取的工作表');
    const matrix = XLSX.utils.sheet_to_json<CellValue[]>(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        blankrows: false,
        defval: null,
    });
    if (matrix.length < 2) throw new Error('费用工作表没有数据');
    if (matrix.length - 1 > MAX_ORDER_EXPENSE_IMPORT_ROWS) {
        throw new Error(`费用导入单次最多 ${MAX_ORDER_EXPENSE_IMPORT_ROWS.toLocaleString()} 行`);
    }

    const headers = matrix[0].map(normalizeHeader);
    const fields = headers.map(header => headerAliases.get(normalizeAlias(header)));
    if (!fields.includes('orderCode')) throw new Error('费用文件缺少“订单号”列');
    if (!fields.includes('carrierShippingCostMicrounits') && !fields.includes('paymentFeeMicrounits')) {
        throw new Error('费用文件至少需要“实际物流成本”或“支付手续费”列');
    }
    const duplicateFields = fields.filter((field, index): field is ExpenseField =>
        Boolean(field && fields.indexOf(field) !== index),
    );
    if (duplicateFields.length > 0) {
        throw new Error(`多个列映射到同一费用字段：${[...new Set(duplicateFields)].join('、')}`);
    }

    const parsedRows: OrderExpenseImportRow[] = [];
    const errors: OrderExpenseImportError[] = [];
    matrix.slice(1).forEach((cells, index) => {
        const rowNumber = index + 2;
        try {
            const values = new Map<ExpenseField, CellValue>();
            fields.forEach((field, fieldIndex) => {
                if (field) values.set(field, cells[fieldIndex]);
            });
            const orderCode = textValue(values.get('orderCode'));
            if (!orderCode) throw new Error(`第 ${rowNumber} 行：订单号不能为空`);
            if (orderCode.length > 64) throw new Error(`第 ${rowNumber} 行：订单号过长`);
            const carrierShippingCostMicrounits = moneyMicrounits(
                values.get('carrierShippingCostMicrounits'),
                rowNumber,
                '实际物流成本',
            );
            const paymentFeeMicrounits = moneyMicrounits(
                values.get('paymentFeeMicrounits'),
                rowNumber,
                '支付手续费',
            );
            if (carrierShippingCostMicrounits === undefined && paymentFeeMicrounits === undefined) {
                throw new Error(`第 ${rowNumber} 行：至少填写一项实际费用，0 元请明确填 0`);
            }
            const note = textValue(values.get('note'));
            if (note.length > 500) throw new Error(`第 ${rowNumber} 行：备注不能超过 500 个字符`);
            parsedRows.push({
                rowNumber,
                orderCode,
                ...(carrierShippingCostMicrounits === undefined ? {} : { carrierShippingCostMicrounits }),
                ...(paymentFeeMicrounits === undefined ? {} : { paymentFeeMicrounits }),
                ...(note ? { note } : {}),
            });
        } catch (error) {
            errors.push({
                rowNumber,
                message: error instanceof Error ? error.message : `第 ${rowNumber} 行：无法解析`,
            });
        }
    });

    const rowsByCode = new Map<string, OrderExpenseImportRow[]>();
    for (const row of parsedRows) {
        const key = row.orderCode.normalize('NFKC').trim().toLocaleLowerCase('en-US');
        const group = rowsByCode.get(key) ?? [];
        group.push(row);
        rowsByCode.set(key, group);
    }
    const duplicateRows = new Set<number>();
    for (const group of rowsByCode.values()) {
        if (group.length < 2) continue;
        for (const row of group) {
            duplicateRows.add(row.rowNumber);
            errors.push({
                rowNumber: row.rowNumber,
                message: `第 ${row.rowNumber} 行：订单号 ${row.orderCode} 在文件中重复`,
            });
        }
    }

    return {
        filename: safeFilename(filename),
        fileHash: await sha256(buffer),
        sheetName,
        headers,
        mappedHeaders: fields.filter(Boolean).length,
        unknownHeaders: headers.filter((_, index) => !fields[index]),
        sourceRowCount: matrix.length - 1,
        rows: parsedRows.filter(row => !duplicateRows.has(row.rowNumber)),
        errors: errors.sort((left, right) => left.rowNumber - right.rowNumber),
    };
}

function readWorkbook(buffer: ArrayBuffer, filename: string): XLSX.WorkBook {
    const bytes = new Uint8Array(buffer);
    const options = {
        cellDates: true,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        dense: true,
        WTF: false,
    } as const;
    if (filename.trim().toLocaleLowerCase('en-US').endsWith('.csv')) {
        try {
            return XLSX.read(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
                ...options,
                type: 'string',
            });
        } catch {
            // Let SheetJS handle legacy CSV code pages.
        }
    }
    return XLSX.read(bytes, { ...options, type: 'array' });
}

function moneyMicrounits(value: CellValue, rowNumber: number, label: string): number | undefined {
    const text = textValue(value);
    if (!text) return undefined;
    const normalized = text
        .replace(/\s+/gu, '')
        .replace(/,/gu, '')
        .replace(/^(?:CNY|MYR|USD|EUR|GBP|SGD|RM)/iu, '')
        .replace(/[¥￥$]/gu, '');
    if (!/^\d+(?:\.\d{1,3})?$/u.test(normalized)) {
        throw new Error(`第 ${rowNumber} 行：${label}必须是非负且最多 3 位小数的金额`);
    }
    const microunits = Math.round(Number(normalized) * 1_000);
    if (!Number.isSafeInteger(microunits)) throw new Error(`第 ${rowNumber} 行：${label}超出可支持范围`);
    return microunits;
}

function normalizeHeader(value: CellValue): string {
    return textValue(value)
        .replace(/[\uff08(]必填[\uff09)]/gu, '')
        .trim();
}

function normalizeAlias(value: string): string {
    return value
        .normalize('NFKC')
        .replace(/[\s_\-]/gu, '')
        .toLocaleLowerCase('en-US');
}

function textValue(value: CellValue): string {
    if (value == null) return '';
    return String(value).normalize('NFKC').trim();
}

function assertExpenseFile(filename: string, byteSize: number): void {
    if (!/\.(numbers|xlsx|xls|csv)$/iu.test(filename)) {
        throw new Error('仅支持 .numbers、.xlsx、.xls 或 .csv 费用文件');
    }
    if (byteSize < 1) throw new Error('费用导入文件为空');
    if (byteSize > MAX_ORDER_EXPENSE_IMPORT_BYTES) throw new Error('费用导入文件不能超过 20MB');
}

function safeFilename(filename: string): string {
    return filename.replace(/[\\/\0]/gu, '_').slice(0, 255) || 'order-expenses.xlsx';
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
