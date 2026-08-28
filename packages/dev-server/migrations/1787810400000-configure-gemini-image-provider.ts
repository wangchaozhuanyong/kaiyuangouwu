import { MigrationInterface, QueryRunner } from 'typeorm';

const GEMINI_SCOPE = 'GEMINI';
const EXPECTED_KEY_LAST4 = '3e5c';
const LEGACY_BASE_URL = 'https://codexgemini.cc/v1';
const STREAM_BASE_URL = 'https://codexgemini.cc/antigravity/v1beta';

export class ConfigureGeminiImageProvider1787810400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('image_provider_credential'))) return;

        await queryRunner.manager
            .createQueryBuilder()
            .update('image_provider_credential')
            .set({
                baseUrl: STREAM_BASE_URL,
                healthStatus: 'UNTESTED',
                healthMessage: null,
                lastTestedAt: null,
            })
            .where('scope = :scope', { scope: GEMINI_SCOPE })
            .andWhere('apiKeyLast4 = :last4', { last4: EXPECTED_KEY_LAST4 })
            .andWhere('baseUrl = :legacyBaseUrl', { legacyBaseUrl: LEGACY_BASE_URL })
            .execute();
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('image_provider_credential'))) return;

        await queryRunner.manager
            .createQueryBuilder()
            .update('image_provider_credential')
            .set({
                baseUrl: LEGACY_BASE_URL,
                healthStatus: 'UNTESTED',
                healthMessage: null,
                lastTestedAt: null,
            })
            .where('scope = :scope', { scope: GEMINI_SCOPE })
            .andWhere('apiKeyLast4 = :last4', { last4: EXPECTED_KEY_LAST4 })
            .andWhere('baseUrl = :streamBaseUrl', { streamBaseUrl: STREAM_BASE_URL })
            .execute();
    }
}
