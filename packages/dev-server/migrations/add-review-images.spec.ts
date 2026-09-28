import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddReviewImages1790310120000 } from './1790310120000-add-review-images';

describe('review images migration', () => {
    it('keeps existing reviews and can run twice on SQLite', async () => {
        const database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(
                new Table({
                    name: 'storefront_review',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'body', type: 'text' },
                    ],
                }),
            );
            await runner.query("INSERT INTO storefront_review (id, body) VALUES (1, 'Existing review')");
            const migration = new AddReviewImages1790310120000();
            await migration.up(runner);
            await migration.up(runner);
            expect(await runner.query('SELECT id, body, imageAssets FROM storefront_review')).toEqual([
                { id: 1, body: 'Existing review', imageAssets: null },
            ]);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
