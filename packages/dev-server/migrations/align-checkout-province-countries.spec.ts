import 'reflect-metadata';
import { DataSource, Table } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { SeedCheckoutProvinces1788742800000 } from './1788742800000-seed-checkout-provinces';
import { AlignCheckoutProvinceCountries1788746400000 } from './1788746400000-align-checkout-province-countries';

let database: DataSource | undefined;

afterEach(async () => {
    await database?.destroy();
    database = undefined;
});

describe('checkout province country alignment migration', () => {
    it('seeds Malaysia states under the enabled translated legacy country code repeatably', async () => {
        database = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = database.createQueryRunner();
        await runner.createTable(
            new Table({
                name: 'region',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: 'datetime' },
                    { name: 'updatedAt', type: 'datetime' },
                    { name: 'code', type: 'varchar' },
                    { name: 'type', type: 'varchar' },
                    { name: 'enabled', type: 'boolean' },
                    { name: 'parentId', type: 'int', isNullable: true },
                    { name: 'discriminator', type: 'varchar' },
                ],
            }),
        );
        await runner.createTable(
            new Table({
                name: 'region_translation',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: 'datetime' },
                    { name: 'updatedAt', type: 'datetime' },
                    { name: 'languageCode', type: 'varchar' },
                    { name: 'name', type: 'varchar' },
                    { name: 'baseId', type: 'int' },
                ],
            }),
        );
        const now = new Date().toISOString();
        await runner.query(
            `INSERT INTO region ("createdAt", "updatedAt", code, type, enabled, "parentId", discriminator) VALUES (?, ?, '001', 'country', 1, NULL, 'Country')`,
            [now, now],
        );
        const [country] = await runner.query(`SELECT id FROM region WHERE code = '001'`);
        await runner.query(
            `INSERT INTO region_translation ("createdAt", "updatedAt", "languageCode", name, "baseId") VALUES (?, ?, 'zh_Hans', '马来西亚', ?)`,
            [now, now, country.id],
        );

        await new SeedCheckoutProvinces1788742800000().up(runner);
        const migration = new AlignCheckoutProvinceCountries1788746400000();
        await migration.up(runner);
        await migration.up(runner);

        const [counts] = await runner.query(
            `SELECT COUNT(*) AS provinces FROM region WHERE discriminator = 'Province' AND "parentId" = ?`,
            [country.id],
        );
        const [translationCounts] = await runner.query(
            `SELECT COUNT(*) AS translations FROM region_translation WHERE "baseId" IN (SELECT id FROM region WHERE discriminator = 'Province' AND "parentId" = ?)`,
            [country.id],
        );
        expect(Number(counts.provinces)).toBe(16);
        expect(Number(translationCounts.translations)).toBe(32);
    });
});
