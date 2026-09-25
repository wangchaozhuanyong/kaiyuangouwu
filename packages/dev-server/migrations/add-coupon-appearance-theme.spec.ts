import { DataSource, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddCouponAppearanceTheme1790208000000 } from './1790208000000-add-coupon-appearance-theme';

describe('coupon appearance migration', () => {
    it('runs against SQLite without changing existing coupon values', async () => {
        const database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(
                new Table({
                    name: 'store_coupon_campaign_config',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'promotionId', type: 'integer' },
                    ],
                }),
            );
            await runner.query('INSERT INTO store_coupon_campaign_config (id, promotionId) VALUES (1, 10)');
            const migration = new AddCouponAppearanceTheme1790208000000();
            await migration.up(runner);
            await migration.up(runner);
            const rows = await runner.query(
                'SELECT promotionId, appearanceTheme FROM store_coupon_campaign_config',
            );
            expect(rows).toEqual([{ promotionId: 10, appearanceTheme: null }]);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });

    it('adds only a nullable display column and is safe to run again', async () => {
        const addColumn = vi.fn();
        let exists = false;
        const runner = {
            getTable: vi.fn(() =>
                Promise.resolve({
                    findColumnByName: (name: string) =>
                        name === 'appearanceTheme' && exists ? { name } : undefined,
                }),
            ),
            addColumn: vi.fn((...args: unknown[]) => {
                exists = true;
                addColumn(...args);
                return Promise.resolve();
            }),
        };
        const migration = new AddCouponAppearanceTheme1790208000000();
        await migration.up(runner as never);
        await migration.up(runner as never);
        expect(addColumn).toHaveBeenCalledTimes(1);
        expect(addColumn).toHaveBeenCalledWith(
            'store_coupon_campaign_config',
            expect.objectContaining({
                name: 'appearanceTheme',
                isNullable: true,
            }),
        );
    });
});
