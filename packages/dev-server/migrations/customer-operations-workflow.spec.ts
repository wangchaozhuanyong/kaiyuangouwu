import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddCustomerOperations1789686000000 } from './1789686000000-add-customer-operations';

describe('customer operations workflow migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'uses portable identity and date columns on %s',
        async databaseType => {
            const created: Table[] = [];
            await new AddCustomerOperations1789686000000().up({
                connection: { options: { type: databaseType } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((table: Table) => {
                    created.push(table);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner);
            const expectedIdType = databaseType === 'mysql' ? 'int' : 'integer';
            expect(created).toHaveLength(3);
            expect(created.every(table => table.findColumnByName('id')?.type === expectedIdType)).toBe(true);
            expect(created[0].indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'UQ_customer_operations_profile_scope',
                        isUnique: true,
                    }),
                ]),
            );
        },
    );

    it('creates an idempotent follow-up evidence ledger in SQL.js', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of ['channel', 'customer']) {
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
            const migration = new AddCustomerOperations1789686000000();
            await migration.up(runner);
            await migration.up(runner);

            await expect(runner.hasTable('customer_operations_profile')).resolves.toBe(true);
            await expect(runner.hasTable('customer_follow_up')).resolves.toBe(true);
            await expect(runner.hasTable('customer_follow_up_event')).resolves.toBe(true);
            const followUp = await runner.getTable('customer_follow_up');
            expect(followUp?.foreignKeys).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'FK_customer_follow_up_profile' }),
                    expect.objectContaining({ name: 'FK_customer_follow_up_customer' }),
                ]),
            );
            const event = await runner.getTable('customer_follow_up_event');
            expect(event?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'UQ_customer_follow_up_event_key', isUnique: true }),
                ]),
            );
            await expect(migration.down()).rejects.toThrow('Retain customer segmentation');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
