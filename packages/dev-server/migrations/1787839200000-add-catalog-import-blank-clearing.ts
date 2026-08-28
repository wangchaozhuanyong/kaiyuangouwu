import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCatalogImportBlankClearing1787839200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('catalog_import_job');
        if (!table || table.findColumnByName('clearBlankFields')) return;
        await queryRunner.addColumn(
            table,
            new TableColumn({
                name: 'clearBlankFields',
                type: 'boolean',
                isNullable: false,
                default: false,
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('catalog_import_job');
        if (!table?.findColumnByName('clearBlankFields')) return;
        await queryRunner.dropColumn(table, 'clearBlankFields');
    }
}
