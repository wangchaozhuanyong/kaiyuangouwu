import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseOrderExpenseArrayBuffer } from './order-expense-local-file';

describe('browser-local order expense parser', () => {
    it('parses partial UTF-8 CSV costs into microunits', async () => {
        const csv = ['订单号,实际物流成本,支付手续费,备注', 'T-1001,12.345,0,补录', 'T-1002,,1.25,'].join(
            '\n',
        );

        const result = await parseOrderExpenseArrayBuffer(
            new TextEncoder().encode(csv).buffer,
            '订单费用.csv',
        );

        expect(result.errors).toEqual([]);
        expect(result.rows).toEqual([
            {
                rowNumber: 2,
                orderCode: 'T-1001',
                carrierShippingCostMicrounits: 12_345,
                paymentFeeMicrounits: 0,
                note: '补录',
            },
            { rowNumber: 3, orderCode: 'T-1002', paymentFeeMicrounits: 1_250 },
        ]);
        expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('removes duplicate order codes from the writable rows', async () => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ['订单编码', '物流成本'],
                ['T-1001', 3],
                ['t-1001', 4],
            ]),
            '订单费用',
        );

        const result = await parseOrderExpenseArrayBuffer(toArrayBuffer(workbook), '订单费用.numbers');

        expect(result.rows).toEqual([]);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.every(error => error.message.includes('在文件中重复'))).toBe(true);
    });

    it('rejects ambiguous or blank expense amounts per row', async () => {
        const csv = ['订单号,支付手续费', 'T-1001,1.2345', 'T-1002,'].join('\n');

        const result = await parseOrderExpenseArrayBuffer(
            new TextEncoder().encode(csv).buffer,
            '订单费用.csv',
        );

        expect(result.rows).toEqual([]);
        expect(result.errors.map(error => error.message)).toEqual([
            '第 2 行：支付手续费必须是非负且最多 3 位小数的金额',
            '第 3 行：至少填写一项实际费用，0 元请明确填 0',
        ]);
    });
});

function toArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return bytes.slice(0);
}
