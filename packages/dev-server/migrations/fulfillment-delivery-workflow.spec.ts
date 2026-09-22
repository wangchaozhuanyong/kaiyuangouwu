import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { CloseFulfillmentDelivery1789599600000 } from './1789599600000-close-fulfillment-delivery';

describe('fulfillment delivery workflow migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'uses portable identity and date columns on %s',
        async databaseType => {
            const created: Table[] = [];
            await new CloseFulfillmentDelivery1789599600000().up({
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
            expect(created[0].indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'UQ_fulfillment_delivery_fulfillment', isUnique: true }),
                ]),
            );
        },
    );

    it('creates an idempotent evidence ledger in SQL.js', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of ['fulfillment', 'order', 'channel']) {
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
            const migration = new CloseFulfillmentDelivery1789599600000();
            await migration.up(runner);
            await migration.up(runner);

            await expect(runner.hasTable('fulfillment_delivery_record')).resolves.toBe(true);
            await expect(runner.hasTable('fulfillment_delivery_event')).resolves.toBe(true);
            const record = await runner.getTable('fulfillment_delivery_record');
            expect(record?.foreignKeys).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'FK_fulfillment_delivery_fulfillment' }),
                    expect.objectContaining({ name: 'FK_fulfillment_delivery_order' }),
                ]),
            );
            const event = await runner.getTable('fulfillment_delivery_event');
            expect(event?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_fulfillment_delivery_event_record_key',
                        isUnique: true,
                    }),
                ]),
            );
            await expect(migration.down()).rejects.toThrow('Retain fulfillment carrier');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
