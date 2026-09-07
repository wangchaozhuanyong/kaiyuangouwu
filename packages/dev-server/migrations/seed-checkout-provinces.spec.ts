import 'reflect-metadata';
import { DataSource, Table } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import {
    SeedCheckoutProvinces1788742800000,
    checkoutProvinceSeeds,
} from './1788742800000-seed-checkout-provinces';

let database: DataSource | undefined;

afterEach(async () => {
    await database?.destroy();
    database = undefined;
});

describe('checkout province seed migration', () => {
    it('seeds bilingual China and Malaysia subdivisions repeatably', async () => {
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
            // eslint-disable-next-line max-len -- Mirrors the complete legacy row shape used by the migration.
            `INSERT INTO region ("createdAt", "updatedAt", code, type, enabled, "parentId", discriminator) VALUES (?, ?, 'CN', 'country', 1, NULL, 'Country'), (?, ?, 'MY', 'country', 1, NULL, 'Country')`,
            [now, now, now, now],
        );

        const migration = new SeedCheckoutProvinces1788742800000();
        await migration.up(runner);
        await migration.up(runner);

        const [counts] = await runner.query(
            `SELECT COUNT(*) AS provinces, COUNT("parentId") AS parented FROM region WHERE discriminator = 'Province'`,
        );
        const [translationCounts] = await runner.query(
            `SELECT COUNT(*) AS translations, COUNT(DISTINCT "languageCode") AS languages FROM region_translation`,
        );
        expect(Number(counts.provinces)).toBe(checkoutProvinceSeeds.length);
        expect(Number(counts.parented)).toBe(checkoutProvinceSeeds.length);
        expect(Number(translationCounts.translations)).toBe(checkoutProvinceSeeds.length * 2);
        expect(Number(translationCounts.languages)).toBe(2);
        expect(checkoutProvinceSeeds.filter(seed => seed.countryCode === 'CN')).toHaveLength(34);
        expect(checkoutProvinceSeeds.filter(seed => seed.countryCode === 'MY')).toHaveLength(16);
    });
});
