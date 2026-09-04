import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

const TABLE_NAME = 'store_profile';

const legalIdentityColumns: TableColumnOptions[] = [
    { name: 'legalEntityName', type: 'varchar', length: '200', isNullable: true },
    { name: 'legalRegistrationCountry', type: 'varchar', length: '100', isNullable: true },
    { name: 'supportEmail', type: 'varchar', length: '254', isNullable: true },
    { name: 'privacyEmail', type: 'varchar', length: '254', isNullable: true },
];

export class AddStoreProfileLegalIdentity1788530400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(TABLE_NAME))) return;
        for (const column of legalIdentityColumns) {
            if (!(await queryRunner.hasColumn(TABLE_NAME, column.name))) {
                await queryRunner.addColumn(TABLE_NAME, new TableColumn(column));
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(TABLE_NAME))) return;
        for (const column of [...legalIdentityColumns].reverse()) {
            if (await queryRunner.hasColumn(TABLE_NAME, column.name)) {
                await queryRunner.dropColumn(TABLE_NAME, column.name);
            }
        }
    }
}
