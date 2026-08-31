import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignUsdtCheckoutRateSchema1787900400000 } from './1787900400000-align-usdt-checkout-rate-schema';

describe('USDT checkout rate schema alignment', () => {
    it('aligns legacy MySQL rate metadata with the entity definition', async () => {
        const table = new Table({
            name: 'storefront_usdt_checkout_quote',
            columns: [
                new TableColumn({
                    name: 'fiatPerUsdtRate',
                    type: 'double',
                    precision: 12,
                    scale: 6,
                    isNullable: true,
                    default: 0,
                }),
            ],
        });
        const changeColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(table),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignUsdtCheckoutRateSchema1787900400000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledOnce();
        expect(changeColumn.mock.calls[0][2]).toMatchObject({
            type: 'float',
            isNullable: false,
        });
        expect(changeColumn.mock.calls[0][2].precision).toBeUndefined();
        expect(changeColumn.mock.calls[0][2].scale).toBeUndefined();
        expect(changeColumn.mock.calls[0][2].default).toBeUndefined();
    });

    it('does not rewrite an already aligned MySQL column', async () => {
        const table = new Table({
            name: 'storefront_usdt_checkout_quote',
            columns: [
                new TableColumn({
                    name: 'fiatPerUsdtRate',
                    type: 'float',
                    isNullable: false,
                }),
            ],
        });
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(table),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignUsdtCheckoutRateSchema1787900400000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });

    it('does not alter non-MySQL databases', async () => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignUsdtCheckoutRateSchema1787900400000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });
});
