import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCustomerServiceFeedback1790310000000 } from './1790310000000-add-customer-service-feedback';

describe('customer service feedback migration', () => {
    it('creates an account and channel scoped table idempotently', async () => {
        const database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of ['channel', 'customer', 'order']) {
                await runner.createTable(
                    new Table({ name, columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
                );
            }
            const migration = new AddCustomerServiceFeedback1790310000000();
            await migration.up(runner);
            await migration.up(runner);
            const table = await runner.getTable('customer_service_feedback');
            expect(table?.indices.find(index => index.isUnique)?.columnNames).toEqual([
                'channelId',
                'customerId',
                'scopeKey',
            ]);
            expect(table?.foreignKeys).toHaveLength(3);
            expect(table?.columns.map(column => column.name)).toContain('rating');
            await migration.down(runner);
            expect(await runner.hasTable('customer_service_feedback')).toBe(false);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
