import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddMarketingAttribution1789689600000 } from './1789689600000-add-marketing-attribution';

describe('marketing attribution workflow migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)('uses portable columns on %s', async type => {
        const created: Table[] = [];
        await new AddMarketingAttribution1789689600000().up({
            connection: { options: { type } },
            hasTable: vi.fn((name: string) => Promise.resolve(name === 'storefront_page_view')),
            hasColumn: vi.fn().mockResolvedValue(false),
            addColumn: vi.fn().mockResolvedValue(undefined),
            createTable: vi.fn((table: Table) => {
                created.push(table);
                return Promise.resolve();
            }),
        } as unknown as QueryRunner);
        expect(created).toHaveLength(2);
        expect(created.map(table => table.name)).toEqual([
            'storefront_order_attribution',
            'marketing_campaign_cost',
        ]);
        expect(created[0].findColumnByName('id')?.type).toBe(type === 'mysql' ? 'int' : 'integer');
        expect(created[1].indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'UQ_marketing_campaign_cost_key', isUnique: true }),
            ]),
        );
    });

    it('applies twice and preserves attribution and cost evidence on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.query('CREATE TABLE channel (id INTEGER PRIMARY KEY)');
            await runner.query('CREATE TABLE "order" (id INTEGER PRIMARY KEY)');
            await runner.createTable(
                new Table({
                    name: 'storefront_page_view',
                    columns: [
                        { name: 'createdAt', type: 'datetime' },
                        { name: 'updatedAt', type: 'datetime' },
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'channelId', type: 'integer' },
                        { name: 'businessDate', type: 'varchar', length: '10' },
                        { name: 'eventId', type: 'varchar', length: '36' },
                        { name: 'visitorKeyHash', type: 'varchar', length: '64' },
                        { name: 'customerKeyHash', type: 'varchar', length: '64', isNullable: true },
                        { name: 'ipHash', type: 'varchar', length: '64', isNullable: true },
                    ],
                }),
            );
            const migration = new AddMarketingAttribution1789689600000();
            await migration.up(runner);
            await migration.up(runner);
            const pageView = await runner.getTable('storefront_page_view');
            expect(pageView?.findColumnByName('attributionKeyHash')).toBeDefined();
            await expect(runner.hasTable('storefront_order_attribution')).resolves.toBe(true);
            await expect(runner.hasTable('marketing_campaign_cost')).resolves.toBe(true);
            await expect(migration.down()).rejects.toThrow('Retain frozen order attribution');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
