import { describe, expect, it, vi } from 'vitest';

import { AddOrderPaymentCurrency1789405200000 } from './1789405200000-add-order-payment-currency';

describe('order payment currency migration', () => {
    it('adds the nullable server-authoritative payment currency field', async () => {
        const addColumn = vi.fn();
        const queryRunner = {
            getTable: vi.fn().mockResolvedValue({ findColumnByName: () => undefined }),
            addColumn,
        };

        await new AddOrderPaymentCurrency1789405200000().up(queryRunner as never);

        expect(addColumn).toHaveBeenCalledOnce();
        expect(addColumn.mock.calls[0]?.[0]).toBe('order');
        expect(addColumn.mock.calls[0]?.[1]).toMatchObject({
            name: 'customFieldsPaymentcurrencycode',
            type: 'varchar',
            length: '8',
            isNullable: true,
        });
    });
});
