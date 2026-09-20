import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddInventoryControlWorkflow1789509600000 } from './1789509600000-add-inventory-control-workflow';

describe('inventory control workflow migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'uses portable identity and date columns on %s',
        async databaseType => {
            const created: Table[] = [];
            await new AddInventoryControlWorkflow1789509600000().up({
                connection: { options: { type: databaseType } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((table: Table) => {
                    created.push(table);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner);
            const expectedIdType = databaseType === 'mysql' ? 'int' : 'integer';
            expect(created).toHaveLength(2);
            expect(created.every(table => table.findColumnByName('id')?.type === expectedIdType)).toBe(true);
            expect(created.find(table => table.name === 'catalog_inventory_operation')?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_catalog_inventory_operation_channel_key',
                        isUnique: true,
                    }),
                ]),
            );
        },
    );

    it('creates an idempotent append-only audit ledger in SQL.js', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of ['channel', 'product_variant', 'stock_location', 'catalog_inventory_lot']) {
                await runner.createTable(
                    new Table({
                        name,
                        columns: [
                            {
                                name: 'id',
                                type: 'integer',
                                isPrimary: true,
                                isGenerated: true,
                                generationStrategy: 'increment',
                            },
                        ],
                    }),
                );
            }
            const migration = new AddInventoryControlWorkflow1789509600000();
            await migration.up(runner);
            await migration.up(runner);

            await expect(runner.hasTable('catalog_inventory_operation')).resolves.toBe(true);
            await expect(runner.hasTable('catalog_inventory_operation_line')).resolves.toBe(true);
            const operation = await runner.getTable('catalog_inventory_operation');
            expect(operation?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_catalog_inventory_operation_channel_key',
                        isUnique: true,
                    }),
                ]),
            );
            const line = await runner.getTable('catalog_inventory_operation_line');
            expect(line?.foreignKeys).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'FK_catalog_inventory_line_operation',
                        onDelete: 'RESTRICT',
                    }),
                    expect.objectContaining({ name: 'FK_catalog_inventory_line_lot', onDelete: 'RESTRICT' }),
                ]),
            );
            await expect(migration.down()).rejects.toThrow('Retain inventory adjustments');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
