import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AlignCatalogManagementSchema1787832000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        await this.alignColumn(queryRunner, 'product_variant', 'customFieldsPackagequantity', column => {
            column.type = 'double';
            column.isNullable = true;
            column.default = 1;
        });

        for (const tableName of ['catalog_import_job', 'catalog_inventory_lot']) {
            await this.alignColumn(queryRunner, tableName, 'version', column => {
                column.type = 'int';
                column.isNullable = false;
                column.default = undefined;
            });
        }
    }

    public async down(): Promise<void> {
        // This forward-only metadata alignment preserves all existing column values.
    }

    private async alignColumn(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
        align: (column: TableColumn) => void,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (!table || !column) return;

        const aligned = column.clone();
        align(aligned);
        if (this.columnsMatch(column, aligned)) return;

        await queryRunner.changeColumn(table, column, aligned);
    }

    private columnsMatch(current: TableColumn, expected: TableColumn): boolean {
        return (
            current.type === expected.type &&
            current.isNullable === expected.isNullable &&
            this.normalizeDefault(current.default) === this.normalizeDefault(expected.default)
        );
    }

    private normalizeDefault(value: string | number | boolean | null | undefined): string | undefined {
        if (value == null) return undefined;
        return String(value)
            .replace(/^\((.*)\)$/u, '$1')
            .trim();
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
