import { MigrationInterface, QueryRunner } from 'typeorm';

const previewTimestampColumns = ['expectedProductUpdatedAt', 'expectedVariantUpdatedAt'];

export class AlignCatalogImportPreviewTimestamps1789387200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await alignPrecision(queryRunner, 6);
    }

    down(queryRunner: QueryRunner): Promise<void> {
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            return Promise.reject(
                new Error(
                    'Timestamp precision cannot be reduced without losing saved preview versions; retain datetime(6)',
                ),
            );
        }
        return Promise.resolve();
    }
}

async function alignPrecision(queryRunner: QueryRunner, precision: number): Promise<void> {
    if (!['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) return;

    const table = await queryRunner.getTable('catalog_import_row');
    if (!table) throw new Error('catalog_import_row must exist before timestamp alignment');
    // Validate all inputs before issuing any DDL. MySQL ALTER TABLE commits implicitly.
    const columns = previewTimestampColumns.map(name => {
        const column = table.findColumnByName(name);
        if (!column) throw new Error(`catalog_import_row.${name} must exist before timestamp alignment`);
        if (column.type !== 'datetime') throw new Error(`catalog_import_row.${name} must be datetime`);
        return column;
    });
    for (const column of columns) {
        if (column.precision === precision) continue;
        const aligned = column.clone();
        aligned.precision = precision;
        await queryRunner.changeColumn(table, column, aligned);
        const index = table.columns.indexOf(column);
        table.columns[index] = aligned;
    }
}
