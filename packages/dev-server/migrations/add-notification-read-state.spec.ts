import { DataSource, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddNotificationReadState1790208120000 } from './1790208120000-add-notification-read-state';

describe('notification read state migration', () => {
    it('runs against an in-memory SQLite schema', async () => {
        const database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of ['channel', 'customer']) {
                await runner.createTable(
                    new Table({ name, columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
                );
            }
            const migration = new AddNotificationReadState1790208120000();
            await migration.up(runner);
            await migration.up(runner);
            const table = await runner.getTable('store_notification_read');
            expect(table?.columns.map(column => column.name)).toContain('readAt');
            expect(table?.indices.find(index => index.isUnique)?.columnNames).toEqual([
                'channelId',
                'customerId',
                'eventKey',
            ]);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });

    it('creates a unique customer and channel scoped table once', async () => {
        let exists = false;
        const createTable = vi.fn(() => {
            exists = true;
            return Promise.resolve();
        });
        const runner = {
            connection: { options: { type: 'sqlite' } },
            hasTable: vi.fn(() => Promise.resolve(exists)),
            createTable,
        };
        const migration = new AddNotificationReadState1790208120000();
        await migration.up(runner as never);
        await migration.up(runner as never);

        expect(createTable).toHaveBeenCalledTimes(1);
        const table = createTable.mock.calls[0][0] as any;
        expect(table.indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    isUnique: true,
                    columnNames: ['channelId', 'customerId', 'eventKey'],
                }),
            ]),
        );
        expect(table.foreignKeys).toHaveLength(2);
        expect(table.columns.map((column: { name: string }) => column.name)).toContain('readAt');
    });
});
