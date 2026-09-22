import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddPurchaseOrderWorkflow1789506000000 } from './1789506000000-add-purchase-order-workflow';

describe('purchase order workflow migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'uses portable identity and date columns on %s',
        async databaseType => {
            const created: Table[] = [];
            await new AddPurchaseOrderWorkflow1789506000000().up({
                connection: { options: { type: databaseType } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((table: Table) => {
                    created.push(table);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner);
            const expectedIdType = databaseType === 'mysql' ? 'int' : 'integer';
            expect(created).toHaveLength(7);
            expect(created.every(table => table.findColumnByName('id')?.type === expectedIdType)).toBe(true);
            expect(
                created.find(table => table.name === 'catalog_purchase_receipt_line')?.foreignKeys,
            ).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'FK_catalog_purchase_receipt_line_lot' }),
                ]),
            );
        },
    );

    it('creates a portable, idempotent and append-only procurement ledger', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of [
                'channel',
                'catalog_supplier',
                'stock_location',
                'product_variant',
                'catalog_inventory_lot',
            ]) {
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
            const migration = new AddPurchaseOrderWorkflow1789506000000();
            await migration.up(runner);
            await migration.up(runner);

            for (const tableName of [
                'catalog_purchase_order',
                'catalog_purchase_order_line',
                'catalog_purchase_receipt',
                'catalog_purchase_receipt_line',
                'catalog_purchase_order_event',
                'catalog_purchase_supplier_return',
                'catalog_purchase_supplier_return_line',
            ]) {
                await expect(runner.hasTable(tableName)).resolves.toBe(true);
            }
            const order = await runner.getTable('catalog_purchase_order');
            expect(order?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_catalog_purchase_order_channel_code',
                        isUnique: true,
                    }),
                    expect.objectContaining({ name: 'IDX_catalog_purchase_order_channel_status' }),
                ]),
            );
            const receipt = await runner.getTable('catalog_purchase_receipt');
            expect(receipt?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_catalog_purchase_receipt_order_key',
                        isUnique: true,
                    }),
                ]),
            );
            expect((await runner.getTable('catalog_purchase_order_event'))?.foreignKeys[0]?.onDelete).toBe(
                'RESTRICT',
            );
            expect((await runner.getTable('catalog_purchase_supplier_return_line'))?.foreignKeys).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'FK_catalog_purchase_return_line_lot',
                        onDelete: 'RESTRICT',
                    }),
                ]),
            );
            await expect(migration.down()).rejects.toThrow('Retain purchase orders');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
