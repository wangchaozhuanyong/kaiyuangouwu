import { DataSource, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddReviewAnonymous1790208060000 } from './1790208060000-add-review-anonymous';

describe('review anonymous migration', () => {
    it('keeps existing reviews publicly attributed by default on SQLite', async () => {
        const database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(
                new Table({
                    name: 'storefront_review',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'customerName', type: 'varchar', length: '120' },
                    ],
                }),
            );
            await runner.query("INSERT INTO storefront_review (id, customerName) VALUES (1, '王***明')");
            const migration = new AddReviewAnonymous1790208060000();
            await migration.up(runner);
            await migration.up(runner);
            const rows = await runner.query('SELECT customerName, anonymous FROM storefront_review');
            expect(rows).toEqual([{ customerName: '王***明', anonymous: 0 }]);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });

    it('defaults existing reviews to non-anonymous and is safe to run again', async () => {
        const addColumn = vi.fn();
        let exists = false;
        const runner = {
            getTable: vi.fn(() =>
                Promise.resolve({
                    findColumnByName: (name: string) =>
                        name === 'anonymous' && exists ? { name } : undefined,
                }),
            ),
            addColumn: vi.fn((...args: unknown[]) => {
                exists = true;
                addColumn(...args);
                return Promise.resolve();
            }),
        };
        const migration = new AddReviewAnonymous1790208060000();
        await migration.up(runner as never);
        await migration.up(runner as never);
        expect(addColumn).toHaveBeenCalledTimes(1);
        expect(addColumn).toHaveBeenCalledWith(
            'storefront_review',
            expect.objectContaining({
                name: 'anonymous',
                isNullable: false,
                default: false,
            }),
        );
    });
});
