import { describe, expect, it } from 'vitest';

import { expenseInputToMicrounits, expenseMicrounitsToInput } from './order-profit-expense';

describe('order profit expense money conversion', () => {
    it('preserves explicit zero and three-decimal precision', () => {
        expect(expenseInputToMicrounits('0', '费用')).toBe(0);
        expect(expenseInputToMicrounits('12.345', '费用')).toBe(12_345);
        expect(expenseMicrounitsToInput(12_340)).toBe('12.34');
    });

    it('keeps a blank distinct from zero and rejects excess precision', () => {
        expect(expenseInputToMicrounits('', '费用')).toBeNull();
        expect(() => expenseInputToMicrounits('1.2345', '费用')).toThrow('最多 3 位小数');
        expect(() => expenseInputToMicrounits('-1', '费用')).toThrow('非负');
    });
});
