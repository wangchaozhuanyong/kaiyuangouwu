import { DataSource, Table } from 'typeorm';
import { expect, it } from 'vitest';

import { AddAfterSalesEvidence1790258400000 } from './1790258400000-add-after-sales-evidence';

it('creates an idempotent private evidence schema with ownership and a pending-storage-cleanup marker', async () => {
    const database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
    const runner = database.createQueryRunner();
    try {
        for (const name of ['channel', 'customer', 'order', 'after_sales_request']) {
            await runner.createTable(
                new Table({ name, columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
            );
        }
        const migration = new AddAfterSalesEvidence1790258400000();
        await migration.up(runner);
        await migration.up(runner);
        const table = await runner.getTable('after_sales_evidence');
        expect(table?.foreignKeys).toHaveLength(4);
        expect(table?.indices.find(index => index.isUnique)?.columnNames).toEqual(['storageKey']);
        expect(table?.columns.find(column => column.name === 'requestId')?.isNullable).toBe(true);
        expect(table?.columns.find(column => column.name === 'storageDeletedAt')?.isNullable).toBe(true);
        await migration.down(runner);
        expect(await runner.hasTable('after_sales_evidence')).toBe(false);
    } finally {
        await runner.release();
        await database.destroy();
    }
});
