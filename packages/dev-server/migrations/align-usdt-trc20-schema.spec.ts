import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignUsdtTrc20Schema1787785200000 } from './1787785200000-align-usdt-trc20-schema';

describe('USDT TRC20 schema alignment migration', () => {
    it('aligns the MySQL quote rate with the entity without changing its value contract', async () => {
        const table = new Table({
            name: 'storefront_usdt_checkout_quote',
            columns: [
                {
                    name: 'fiatPerUsdtRate',
                    type: 'double',
                    isNullable: false,
                },
            ],
        });
        const changeColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(table),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignUsdtTrc20Schema1787785200000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledOnce();
        const [, current, aligned] = changeColumn.mock.calls[0] as [Table, TableColumn, TableColumn];
        expect(current.type).toBe('double');
        expect(aligned).toMatchObject({
            name: 'fiatPerUsdtRate',
            type: 'float',
            isNullable: false,
        });
    });

    it.each(['postgres', 'sqlite'] as const)('leaves %s unchanged', async databaseType => {
        const getTable = vi.fn();
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignUsdtTrc20Schema1787785200000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
        expect(changeColumn).not.toHaveBeenCalled();
    });
});
