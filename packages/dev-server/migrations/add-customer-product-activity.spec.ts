import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCustomerProductActivity1790310060000 } from './1790310060000-add-customer-product-activity';

describe('customer product activity migration', () => {
    it('creates scoped favorite and history rows idempotently', async () => {
        const database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of ['channel', 'customer', 'product']) {
                await runner.createTable(
                    new Table({ name, columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
                );
            }
            const migration = new AddCustomerProductActivity1790310060000();
            await migration.up(runner);
            await migration.up(runner);
            const table = await runner.getTable('customer_product_activity');
            expect(table?.indices.find(index => index.isUnique)?.columnNames).toEqual([
                'channelId',
                'customerId',
                'kind',
                'productId',
            ]);
            expect(table?.foreignKeys).toHaveLength(3);
            await migration.down(runner);
            expect(await runner.hasTable('customer_product_activity')).toBe(false);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
