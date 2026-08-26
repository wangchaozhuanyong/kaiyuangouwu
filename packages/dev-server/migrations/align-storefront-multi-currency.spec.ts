import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignStorefrontMultiCurrency1787767200000 } from './1787767200000-align-storefront-multi-currency';

describe('storefront multi-currency schema alignment', () => {
    it('aligns MySQL rate and timestamp precision', async () => {
        const channel = new Table({
            name: 'channel',
            columns: [
                { name: 'customFieldsCnytomyrrate', type: 'float', isNullable: true },
                { name: 'customFieldsCurrencyrateupdatedat', type: 'datetime', isNullable: true },
                { name: 'customFieldsCurrencypricesupdatedat', type: 'datetime', isNullable: true },
            ],
        });
        const changed: Array<{ name: string; type: string; precision?: number | null }> = [];
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(channel),
            changeColumn: vi.fn((_table, _current, next) => {
                changed.push({ name: next.name, type: next.type, precision: next.precision });
                return Promise.resolve();
            }),
        } as unknown as QueryRunner;

        await new AlignStorefrontMultiCurrency1787767200000().up(queryRunner);

        expect(changed).toEqual([
            { name: 'customFieldsCnytomyrrate', type: 'double', precision: undefined },
            { name: 'customFieldsCurrencyrateupdatedat', type: 'datetime', precision: 6 },
            { name: 'customFieldsCurrencypricesupdatedat', type: 'datetime', precision: 6 },
        ]);
    });

    it('does nothing on non-MySQL databases', async () => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignStorefrontMultiCurrency1787767200000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });
});
