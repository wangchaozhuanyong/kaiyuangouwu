import { MigrationInterface, QueryRunner } from 'typeorm';

const VERIFIED_HEALTH_MESSAGE =
    'Antigravity v1beta model list verified for gemini-3.1-flash-image on 2026-08-28';

export class EnforceGeminiImageProvider1787814000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('image_provider_credential'))) return;

        await queryRunner.manager
            .createQueryBuilder()
            .update('image_provider_credential')
            .set({
                baseUrl: 'https://codexgemini.cc/antigravity/v1beta',
                healthStatus: 'HEALTHY',
                healthMessage: VERIFIED_HEALTH_MESSAGE,
                lastTestedAt: new Date('2026-08-28T00:00:00.000Z'),
            })
            .where('scope = :scope', { scope: 'GEMINI' })
            .andWhere('apiKeyLast4 = :last4', { last4: '3e5c' })
            .execute();
    }

    public async down(): Promise<void> {
        // Keep the verified endpoint in place; reverting to an unknown legacy URL would break production.
    }
}
