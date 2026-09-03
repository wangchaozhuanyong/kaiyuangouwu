import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddImagePromptModelConfigs1788436800000 } from './1788436800000-add-image-prompt-model-configs';

describe('image prompt model config migration', () => {
    it('creates the entity-compatible table and idempotently backfills AUTO prompt credentials', async () => {
        const { dataSource, queryRunner } = await legacyDataSource();
        try {
            await insertCredential(queryRunner, {
                code: 'gemini-primary',
                name: 'Gemini 主 Key',
                scope: 'GEMINI',
                purpose: 'BOTH',
                enabled: true,
                textModelId: 'gemini-2.5-flash',
                priority: 10,
                encryptedApiKey: 'encrypted-gemini',
                apiKeyLast4: '1234',
                healthStatus: 'HEALTHY',
            });
            await insertCredential(queryRunner, {
                code: 'image-only',
                name: '仅生图',
                scope: 'OPENAI',
                purpose: 'IMAGE',
                enabled: true,
                textModelId: 'gpt-5.4-mini',
                priority: 20,
                encryptedApiKey: 'encrypted-image',
                apiKeyLast4: '5678',
                healthStatus: 'HEALTHY',
            });
            await insertRouting(queryRunner, { strategy: 'AUTO' });

            const migration = new AddImagePromptModelConfigs1788436800000();
            await migration.up(queryRunner);
            await migration.up(queryRunner);

            const table = await queryRunner.getTable('image_prompt_model_config');
            expect(table?.indices.map(index => index.name).sort()).toEqual([
                'IDX_image_prompt_model_config_code',
                'IDX_image_prompt_model_config_priority',
            ]);
            expect(table?.columns.map(column => column.name)).toEqual([
                'createdAt',
                'updatedAt',
                'id',
                'code',
                'name',
                'enabled',
                'baseUrl',
                'encryptedApiKey',
                'apiKeyLast4',
                'modelId',
                'apiFormat',
                'priority',
                'weight',
                'currentWeight',
                'healthStatus',
                'healthMessage',
                'lastTestedAt',
                'consecutiveFailures',
                'cooldownUntil',
                'lastUsedAt',
                'archivedAt',
            ]);
            const models = (await queryRunner.query(
                `SELECT code, modelId, apiFormat, encryptedApiKey, apiKeyLast4, priority
                 FROM image_prompt_model_config
                 WHERE enabled = 1 AND healthStatus = 'HEALTHY' AND archivedAt IS NULL
                 ORDER BY priority`,
            )) as Array<Record<string, unknown>>;
            expect(models).toHaveLength(1);
            expect(models[0]).toMatchObject({
                code: 'gemini-primary',
                modelId: 'gemini-2.5-flash',
                apiFormat: 'GEMINI',
                encryptedApiKey: 'encrypted-gemini',
                apiKeyLast4: '1234',
                priority: 10,
            });
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });

    it('preserves FIXED primary/fallback order and copies encrypted keys without decrypting them', async () => {
        const { dataSource, queryRunner } = await legacyDataSource();
        try {
            await insertCredential(queryRunner, {
                code: 'openai-primary',
                name: 'OpenAI 主 Key',
                scope: 'OPENAI',
                purpose: 'PROMPT',
                enabled: true,
                textModelId: 'legacy-openai-model',
                priority: 50,
                encryptedApiKey: 'encrypted-openai',
                apiKeyLast4: '1111',
                healthStatus: 'HEALTHY',
            });
            await insertCredential(queryRunner, {
                code: 'gemini-fallback',
                name: 'Gemini 备用 Key',
                scope: 'GEMINI',
                purpose: 'BOTH',
                enabled: true,
                textModelId: 'legacy-gemini-model',
                priority: 5,
                encryptedApiKey: 'encrypted-gemini',
                apiKeyLast4: '2222',
                healthStatus: 'HEALTHY',
            });
            await insertRouting(queryRunner, {
                strategy: 'FIXED',
                primaryCredentialCode: 'openai-primary',
                primaryModelId: 'gpt-5.4-mini',
                fallbackEnabled: true,
                fallbackCredentialCode: 'gemini-fallback',
                fallbackModelId: 'gemini-2.5-flash',
            });

            await new AddImagePromptModelConfigs1788436800000().up(queryRunner);

            const rows = (await queryRunner.query(
                `SELECT code, modelId, priority, encryptedApiKey
                 FROM image_prompt_model_config ORDER BY priority`,
            )) as Array<{
                code: string;
                modelId: string;
                priority: number;
                encryptedApiKey: string;
            }>;
            expect(rows.map(row => [row.code, row.modelId, row.priority, row.encryptedApiKey])).toEqual([
                ['openai-primary', 'gpt-5.4-mini', 0, 'encrypted-openai'],
                ['gemini-fallback', 'gemini-2.5-flash', 10, 'encrypted-gemini'],
            ]);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });

    it('fails instead of silently disabling optimization when a FIXED route cannot be mapped', async () => {
        const { dataSource, queryRunner } = await legacyDataSource();
        try {
            await insertRouting(queryRunner, {
                strategy: 'FIXED',
                primaryCredentialCode: 'missing-key',
                primaryModelId: 'gpt-5.4-mini',
            });

            await expect(new AddImagePromptModelConfigs1788436800000().up(queryRunner)).rejects.toThrow(
                'fixed primary route missing-key maps to 0 credentials',
            );
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});

async function legacyDataSource(): Promise<{ dataSource: DataSource; queryRunner: QueryRunner }> {
    const dataSource = new DataSource({
        type: 'sqljs',
        entities: [],
        synchronize: false,
    });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.createTable(
        new Table({
            name: 'image_provider_credential',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                { name: 'scope', type: 'varchar', length: '24' },
                { name: 'code', type: 'varchar', length: '64' },
                { name: 'name', type: 'varchar', length: '120' },
                { name: 'purpose', type: 'varchar', length: '24' },
                { name: 'enabled', type: 'boolean' },
                { name: 'baseUrl', type: 'varchar', length: '500' },
                { name: 'encryptedApiKey', type: 'text' },
                { name: 'apiKeyLast4', type: 'varchar', length: '8' },
                { name: 'textModelId', type: 'varchar', length: '160' },
                { name: 'priority', type: 'int' },
                { name: 'weight', type: 'int' },
                { name: 'currentWeight', type: 'int' },
                { name: 'healthStatus', type: 'varchar', length: '24' },
                { name: 'healthMessage', type: 'varchar', length: '500', isNullable: true },
                { name: 'lastTestedAt', type: 'datetime', isNullable: true },
                { name: 'consecutiveFailures', type: 'int' },
                { name: 'cooldownUntil', type: 'datetime', isNullable: true },
                { name: 'lastUsedAt', type: 'datetime', isNullable: true },
                { name: 'archivedAt', type: 'datetime', isNullable: true },
            ],
        }),
    );
    await queryRunner.createTable(
        new Table({
            name: 'image_prompt_routing_config',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                { name: 'singletonKey', type: 'varchar', length: '16' },
                { name: 'strategy', type: 'varchar', length: '16' },
                { name: 'primaryCredentialCode', type: 'varchar', length: '64', isNullable: true },
                { name: 'primaryModelId', type: 'varchar', length: '160', isNullable: true },
                { name: 'fallbackEnabled', type: 'boolean' },
                { name: 'fallbackCredentialCode', type: 'varchar', length: '64', isNullable: true },
                { name: 'fallbackModelId', type: 'varchar', length: '160', isNullable: true },
            ],
        }),
    );
    return { dataSource, queryRunner };
}

async function insertCredential(
    queryRunner: QueryRunner,
    input: {
        code: string;
        name: string;
        scope: string;
        purpose: string;
        enabled: boolean;
        textModelId: string;
        priority: number;
        encryptedApiKey: string;
        apiKeyLast4: string;
        healthStatus: string;
    },
): Promise<void> {
    await queryRunner.manager.insert('image_provider_credential', {
        ...input,
        baseUrl: 'https://relay.example.com/v1',
        weight: 1,
        currentWeight: 0,
        healthMessage: 'ok',
        lastTestedAt: new Date('2026-09-03T00:00:00.000Z'),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastUsedAt: null,
        archivedAt: null,
    });
}

async function insertRouting(
    queryRunner: QueryRunner,
    input: {
        strategy: 'AUTO' | 'FIXED';
        primaryCredentialCode?: string;
        primaryModelId?: string;
        fallbackEnabled?: boolean;
        fallbackCredentialCode?: string;
        fallbackModelId?: string;
    },
): Promise<void> {
    await queryRunner.manager.insert('image_prompt_routing_config', {
        singletonKey: 'GLOBAL',
        strategy: input.strategy,
        primaryCredentialCode: input.primaryCredentialCode ?? null,
        primaryModelId: input.primaryModelId ?? null,
        fallbackEnabled: input.fallbackEnabled ?? false,
        fallbackCredentialCode: input.fallbackCredentialCode ?? null,
        fallbackModelId: input.fallbackModelId ?? null,
    });
}
