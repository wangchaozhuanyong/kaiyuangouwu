import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddImageGeneration1787792400000 } from './1787792400000-add-image-generation';

describe('image generation migration', () => {
    it('applies and rolls back the complete schema against SQL.js', async () => {
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
            const migration = new AddImageGeneration1787792400000();

            await migration.up(queryRunner);

            const expectedTables = [
                'referral_wallet_usage',
                'image_generation_config',
                'image_provider_credential',
                'image_model_config',
                'image_prompt_skill_release',
                'image_prompt_optimization',
                'image_private_asset',
                'image_generation_job',
                'image_generation_output',
            ];
            for (const tableName of expectedTables) {
                await expect(queryRunner.hasTable(tableName)).resolves.toBe(true);
            }
            const usage = await queryRunner.getTable('referral_wallet_usage');
            expect(
                usage?.indices.find(index => index.name === 'IDX_referral_wallet_usage_idempotency')
                    ?.isUnique,
            ).toBe(true);
            const jobs = await queryRunner.getTable('image_generation_job');
            expect(jobs?.findColumnByName('unitPriceSnapshot')?.type).toBe('int');
            expect(
                jobs?.indices.find(index => index.name === 'IDX_image_generation_job_idempotency')?.isUnique,
            ).toBe(true);
            const outputs = await queryRunner.getTable('image_generation_output');
            expect(outputs?.findColumnByName('refundedAt')?.isNullable).toBe(true);
            expect(outputs?.foreignKeys).toHaveLength(2);
            const models = await queryRunner.getTable('image_model_config');
            expect(models?.findColumnByName('descriptionZh')?.length).toBe('500');
            expect(models?.findColumnByName('descriptionEn')?.length).toBe('500');
            expect(models?.findColumnByName('healthMessage')?.isNullable).toBe(true);
            expect(models?.findColumnByName('lastTestedAt')?.isNullable).toBe(true);

            await migration.down(queryRunner);
            for (const tableName of expectedTables) {
                await expect(queryRunner.hasTable(tableName)).resolves.toBe(false);
            }
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
