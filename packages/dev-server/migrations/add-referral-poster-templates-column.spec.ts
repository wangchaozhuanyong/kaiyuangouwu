import { describe, expect, it } from 'vitest';
import { DataSource, Table, TableColumn } from 'typeorm';
import { AddReferralPosterTemplatesColumn1788410000000 } from './1788410000000-add-referral-poster-templates-column';

describe('AddReferralPosterTemplatesColumn1788410000000 migration', () => {
    it('adds posterTemplates column if not exists, and drops it on down', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();

        await queryRunner.createTable(
            new Table({
                name: 'referral_program_config',
                columns: [
                    new TableColumn({ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }),
                    new TableColumn({ name: 'defaultPosterTemplate', type: 'varchar', length: '64' }),
                ],
            }),
            true,
        );

        const migration = new AddReferralPosterTemplatesColumn1788410000000();
        await migration.up(queryRunner);

        let table = await queryRunner.getTable('referral_program_config');
        expect(table?.findColumnByName('posterTemplates')).toBeDefined();

        await migration.down(queryRunner);
        table = await queryRunner.getTable('referral_program_config');
        expect(table?.findColumnByName('posterTemplates')).toBeUndefined();

        await queryRunner.release();
        await dataSource.destroy();
    });
});
