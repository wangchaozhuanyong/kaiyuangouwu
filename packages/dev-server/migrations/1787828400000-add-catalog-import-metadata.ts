import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const metadataColumns = [
    new TableColumn({
        name: 'sheetName',
        type: 'varchar',
        length: '255',
        isNullable: true,
    }),
    new TableColumn({
        name: 'detectedHeaders',
        type: 'text',
        isNullable: true,
    }),
    new TableColumn({
        name: 'fieldMapping',
        type: 'text',
        isNullable: true,
    }),
];

export class AddCatalogImportMetadata1787828400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('catalog_import_job');
        if (!table) return;
        for (const column of metadataColumns) {
            if (!table.findColumnByName(column.name)) {
                await queryRunner.addColumn('catalog_import_job', column);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('catalog_import_job');
        if (!table) return;
        for (const column of [...metadataColumns].reverse()) {
            if (table.findColumnByName(column.name)) {
                await queryRunner.dropColumn('catalog_import_job', column.name);
            }
        }
    }
}
