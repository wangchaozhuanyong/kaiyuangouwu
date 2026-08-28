import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { ConfigureGeminiImageProvider1787810400000 } from './1787810400000-configure-gemini-image-provider';

describe('Gemini image provider configuration migration', () => {
    it('updates only the expected Gemini credential and remains idempotent', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'image_provider_credential',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'scope', type: 'varchar' },
                        { name: 'baseUrl', type: 'varchar' },
                        { name: 'apiKeyLast4', type: 'varchar' },
                        { name: 'healthStatus', type: 'varchar' },
                        { name: 'healthMessage', type: 'varchar', isNullable: true },
                        { name: 'lastTestedAt', type: 'datetime', isNullable: true },
                    ],
                }),
            );
            await queryRunner.query(
                `INSERT INTO "image_provider_credential" VALUES
                    (1, 'GEMINI', 'https://codexgemini.cc/v1', '3e5c', 'HEALTHY', 'old', '2026-08-27 00:00:00'),
                    (2, 'OPENAI', 'https://codexgemini.cc/v1', 'f8d8', 'HEALTHY', 'keep', '2026-08-27 00:00:00'),
                    (3, 'GEMINI', 'https://custom.example/v1', 'other', 'HEALTHY', 'keep', '2026-08-27 00:00:00')`,
            );

            const migration = new ConfigureGeminiImageProvider1787810400000();
            await migration.up(queryRunner);
            await migration.up(queryRunner);

            expect(
                await queryRunner.query(`SELECT * FROM "image_provider_credential" ORDER BY "id"`),
            ).toEqual([
                {
                    id: 1,
                    scope: 'GEMINI',
                    baseUrl: 'https://codexgemini.cc/antigravity/v1beta',
                    apiKeyLast4: '3e5c',
                    healthStatus: 'UNTESTED',
                    healthMessage: null,
                    lastTestedAt: null,
                },
                {
                    id: 2,
                    scope: 'OPENAI',
                    baseUrl: 'https://codexgemini.cc/v1',
                    apiKeyLast4: 'f8d8',
                    healthStatus: 'HEALTHY',
                    healthMessage: 'keep',
                    lastTestedAt: '2026-08-27 00:00:00',
                },
                {
                    id: 3,
                    scope: 'GEMINI',
                    baseUrl: 'https://custom.example/v1',
                    apiKeyLast4: 'other',
                    healthStatus: 'HEALTHY',
                    healthMessage: 'keep',
                    lastTestedAt: '2026-08-27 00:00:00',
                },
            ]);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
