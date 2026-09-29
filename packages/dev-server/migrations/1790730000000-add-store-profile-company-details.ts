import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

const TABLE_NAME = 'store_profile';

const companyDetailColumns: TableColumnOptions[] = [
    { name: 'legalRegistrationNumber', type: 'varchar', length: '100', isNullable: true },
    { name: 'legalContactAddress', type: 'varchar', length: '500', isNullable: true },
];

export class AddStoreProfileCompanyDetails1790730000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(TABLE_NAME))) return;
        for (const column of companyDetailColumns) {
            if (!(await queryRunner.hasColumn(TABLE_NAME, column.name))) {
                await queryRunner.addColumn(TABLE_NAME, new TableColumn(column));
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(TABLE_NAME))) return;
        for (const column of [...companyDetailColumns].reverse()) {
            if (await queryRunner.hasColumn(TABLE_NAME, column.name)) {
                await queryRunner.dropColumn(TABLE_NAME, column.name);
            }
        }
    }
}
