import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddReferralPosterTemplatesColumn1788410000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('referral_program_config')) {
            const table = await queryRunner.getTable('referral_program_config');
            if (table && !table.findColumnByName('posterTemplates')) {
                await queryRunner.addColumn(
                    'referral_program_config',
                    new TableColumn({
                        name: 'posterTemplates',
                        type: 'text',
                        isNullable: true,
                    }),
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('referral_program_config')) {
            const table = await queryRunner.getTable('referral_program_config');
            if (table?.findColumnByName('posterTemplates')) {
                await queryRunner.dropColumn('referral_program_config', 'posterTemplates');
            }
        }
    }
}
