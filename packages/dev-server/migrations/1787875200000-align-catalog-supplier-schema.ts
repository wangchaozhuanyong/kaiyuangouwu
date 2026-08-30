import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AlignCatalogSupplierSchema1787875200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        const table = await queryRunner.getTable('catalog_supplier');
        const current = table?.findColumnByName('enabled');
        if (!table || !current) return;

        const aligned = current.clone();
        aligned.type = 'tinyint';
        aligned.width = undefined;
        aligned.isNullable = false;
        aligned.default = 1;

        if (this.columnsMatch(current, aligned)) return;
        await queryRunner.changeColumn(table, current, aligned);
    }

    public async down(): Promise<void> {
        // Forward-only metadata alignment. Reverting would recreate the production drift.
    }

    private columnsMatch(current: TableColumn, expected: TableColumn): boolean {
        return (
            current.type === expected.type &&
            current.width === expected.width &&
            current.isNullable === expected.isNullable &&
            this.normalizeDefault(current.default) === this.normalizeDefault(expected.default)
        );
    }

    private normalizeDefault(value: string | number | boolean | null | undefined): string | undefined {
        if (value == null) return undefined;
        return String(value)
            .replace(/^\((.*)\)$/u, '$1')
            .replace(/^'(.*)'$/u, '$1')
            .trim()
            .toLowerCase();
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
