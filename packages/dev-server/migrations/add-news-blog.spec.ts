import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddNewsBlog1793491200000 } from './1793491200000-add-news-blog';
import { AddBlogSkills1793577600000 } from './1793577600000-add-blog-skills';
import { AddBlogSourceMetadata1793577660000 } from './1793577660000-add-blog-source-metadata';
describe('news blog additive migration', () => {
    it('creates isolated tables, preserves existing data, supports repeated execution and rejects destructive rollback', async () => {
        const db = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = db.createQueryRunner();
        try {
            await runner.createTable(
                new Table({
                    name: 'channel',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'code', type: 'varchar' },
                    ],
                }),
            );
            await runner.query("INSERT INTO channel VALUES (1,'existing-store')");
            const migration = new AddNewsBlog1793491200000();
            await migration.up(runner);
            await migration.up(runner);
            expect(await runner.query('SELECT * FROM channel')).toEqual([{ id: 1, code: 'existing-store' }]);
            for (const name of ['settings', 'article', 'revision', 'source', 'source_item', 'run'])
                expect(await runner.hasTable(`news_blog_${name}`)).toBe(true);
            const skills = new AddBlogSkills1793577600000();
            await skills.up(runner);
            await skills.up(runner);
            for (const suffix of ['skill', 'skill_observation', 'skill_state', 'skill_recommendation'])
                expect(await runner.hasTable(`news_blog_${suffix}`)).toBe(true);
            const metadata = new AddBlogSourceMetadata1793577660000();
            await metadata.up(runner);
            await metadata.up(runner);
            expect(
                (await runner.getTable('news_blog_source_item'))?.findColumnByName('metadataJson')
                    ?.isNullable,
            ).toBe(true);
            const recommendation = await runner.getTable('news_blog_skill_recommendation');
            expect(recommendation?.indices.filter(x => x.isUnique).map(x => x.columnNames)).toEqual(
                expect.arrayContaining([
                    ['channelId', 'day'],
                    ['channelId', 'identity'],
                ]),
            );
            expect(
                (await runner.getTable('news_blog_skill'))?.columns.some(x => x.name === 'channelId'),
            ).toBe(false);
            expect(await runner.query('SELECT * FROM channel')).toEqual([{ id: 1, code: 'existing-store' }]);
            await expect(skills.down()).rejects.toThrow('Retain skill identities');
            expect(
                (await runner.getTable('news_blog_run'))?.indices.find(x => x.name === 'UQ_news_blog_run_key')
                    ?.isUnique,
            ).toBe(true);
            expect((await runner.getTable('news_blog_article'))?.foreignKeys[0].referencedTableName).toBe(
                'channel',
            );
            await expect(migration.down()).rejects.toThrow('Retain news blog');
        } finally {
            await runner.release();
            await db.destroy();
        }
    });
});
