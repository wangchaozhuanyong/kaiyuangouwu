import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddInventoryLotMovements1787835600000 } from './1787835600000-add-inventory-lot-movements';

describe('inventory lot movement migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable audit storage on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((createdTable: Table) => {
                    createdTables.push(createdTable);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddInventoryLotMovements1787835600000().up(queryRunner);

            expect(createdTables).toHaveLength(1);
            const table = createdTables[0];
            expect(table.name).toBe('catalog_inventory_lot_movement');
            expect(table.findColumnByName('id')?.type).toBe(databaseType === 'mysql' ? 'int' : 'integer');
            expect(table.findColumnByName('orderLineId')).toMatchObject({ isNullable: true });
            expect(table.findColumnByName('quantity')).toMatchObject({ type: 'int', isNullable: false });
            expect(table.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_catalog_lot_movement_stock_lot',
                        isUnique: true,
                    }),
                    expect.objectContaining({ name: 'IDX_catalog_lot_movement_order_line' }),
                ]),
            );
            expect(table.foreignKeys.map(key => key.name)).toEqual([
                'FK_catalog_lot_movement_lot',
                'FK_catalog_lot_movement_stock',
                'FK_catalog_lot_movement_order_line',
                'FK_catalog_lot_movement_variant',
                'FK_catalog_lot_movement_location',
            ]);
        },
    );

    it('does not recreate an existing audit table', async () => {
        const createTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn().mockResolvedValue(true),
            createTable,
        } as unknown as QueryRunner;

        await new AddInventoryLotMovements1787835600000().up(queryRunner);

        expect(createTable).not.toHaveBeenCalled();
    });
});
