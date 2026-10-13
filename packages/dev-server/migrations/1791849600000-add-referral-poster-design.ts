import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Nullable text matches TypeORM's simple-json mapping on MySQL, Postgres and SQLite. */
export class AddReferralPosterDesign1791849600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('referral_poster_template');
        if (table && !table.findColumnByName('design')) {
            await queryRunner.addColumn(
                table,
                new TableColumn({ name: 'design', type: 'text', isNullable: true }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('referral_poster_template');
        if (table?.findColumnByName('design')) {
            await queryRunner.dropColumn(table, 'design');
        }
    }
}
