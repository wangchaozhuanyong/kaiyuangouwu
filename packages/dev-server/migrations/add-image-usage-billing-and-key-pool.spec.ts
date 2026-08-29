import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddImageGeneration1787792400000 } from './1787792400000-add-image-generation';
import { HardenImageGeneration1787817600000 } from './1787817600000-harden-image-generation';
import { AddImageUsageBillingAndKeyPool1787832000000 } from './1787832000000-add-image-usage-billing-and-key-pool';

describe('image usage billing and key pool migration', () => {
    it('adds quota, billing, audit and multi-key schema while preserving legacy bindings', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            for (const tableName of ['channel', 'customer', 'referral_wallet']) {
                await queryRunner.createTable(
                    new Table({
                        name: tableName,
                        columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                    }),
                );
            }
            await new AddImageGeneration1787792400000().up(queryRunner);
            await new HardenImageGeneration1787817600000().up(queryRunner);
            await queryRunner.query('INSERT INTO channel (id) VALUES (1)');
            await queryRunner.query(
                `INSERT INTO image_generation_config
                 (channelId, enabled, promptOptimizationEnabled, defaultModelCode, termsVersion, termsZh, termsEn)
                 VALUES (1, 0, 1, 'OPENAI_HIGH_QUALITY', '2026-08-27', '旧条款', 'Legacy terms')`,
            );
            await queryRunner.query(
                `INSERT INTO image_provider_credential
                 (scope, enabled, baseUrl, encryptedApiKey, apiKeyLast4, textModelId, healthStatus)
                 VALUES ('OPENAI', 1, 'https://relay.example.com/v1', 'encrypted', '1234', 'gpt-test', 'HEALTHY')`,
            );
            await queryRunner.query(
                `INSERT INTO image_model_config
                 (channelId, code, enabled, displayNameZh, displayNameEn, descriptionZh, descriptionEn,
                  officialModelId, providerModelId, protocol, unitPrice, currencyCode, position, isDefault,
                  healthStatus, supportsIdempotency, consecutiveFailures)
                 VALUES (1, 'OPENAI_HIGH_QUALITY', 1, '测试', 'Test', '测试', 'Test', 'gpt-image',
                         'gpt-image', 'OPENAI_IMAGES', 100, 'CNY', 0, 1, 'HEALTHY', 0, 0)`,
            );

            await new AddImageUsageBillingAndKeyPool1787832000000().up(queryRunner);

            for (const tableName of [
                'image_usage_quota_bucket',
                'image_usage_quota_event',
                'image_provider_credential_model',
                'image_compliance_audit_event',
            ]) {
                await expect(queryRunner.hasTable(tableName)).resolves.toBe(true);
            }
            const config = await queryRunner.getTable('image_generation_config');
            expect(config?.findColumnByName('promptRateLimitPerMinute')?.default).toBe('3');
            expect(config?.findColumnByName('promptDailyFreeLimit')?.default).toBe('20');
            const configRows = (await queryRunner.query(
                'SELECT termsVersion, termsZh FROM image_generation_config',
            )) as Array<{ termsVersion: string; termsZh: string }>;
            expect(configRows[0].termsVersion).toBe('2026-08-28-audit');
            expect(configRows[0].termsZh).toContain('客户删除生成记录');
            const model = await queryRunner.getTable('image_model_config');
            expect(model?.findColumnByName('dailyFreeImageLimit')?.default).toBe('0');
            const job = await queryRunner.getTable('image_generation_job');
            expect(job?.findColumnByName('expectedChargeAmount')).toBeTruthy();
            expect(job?.findColumnByName('customerDeletedAt')?.isNullable).toBe(true);
            const prompt = await queryRunner.getTable('image_prompt_optimization');
            expect(prompt?.findColumnByName('upstreamCallCount')?.default).toBe('0');
            expect(prompt?.findColumnByName('credentialSelectionReason')?.isNullable).toBe(true);
            expect(
                prompt?.indices.some(index => index.name === 'IDX_image_prompt_optimization_idempotency'),
            ).toBe(true);
            const credential = await queryRunner.getTable('image_provider_credential');
            expect(
                credential?.indices.some(index => index.name === 'IDX_image_provider_credential_scope'),
            ).toBe(false);
            expect(
                credential?.indices.find(index => index.name === 'IDX_image_provider_credential_code')
                    ?.isUnique,
            ).toBe(true);
            const rows = (await queryRunner.query(
                'SELECT code, name FROM image_provider_credential',
            )) as Array<{ code: string; name: string }>;
            expect(rows[0].code).toMatch(/^openai-primary-/u);
            expect(rows[0].name).toBe('OPENAI 主 Key');
            const bindings = (await queryRunner.query(
                'SELECT credentialId, modelConfigId FROM image_provider_credential_model',
            )) as unknown[];
            expect(bindings).toHaveLength(1);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
