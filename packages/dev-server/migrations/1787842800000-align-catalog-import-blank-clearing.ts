import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignCatalogImportBlankClearing1787842800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        const table = await queryRunner.getTable('catalog_import_job');
        const column = table?.findColumnByName('clearBlankFields');
        if (!table || !column) return;

        const isAligned =
            column.type.toLowerCase() === 'tinyint' &&
            column.width === undefined &&
            !column.isNullable &&
            this.isFalseDefault(column.default);
        if (isAligned) return;

        const aligned = column.clone();
        aligned.type = 'tinyint';
        aligned.width = undefined;
        aligned.isNullable = false;
        aligned.default = 0;
        await queryRunner.changeColumn(table, column, aligned);
    }

    public async down(): Promise<void> {
        // This forward-only metadata alignment preserves every existing flag value.
    }

    private isFalseDefault(value: unknown): boolean {
        if (value === false || value === 0) return true;
        if (typeof value !== 'string') return false;

        const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
        return ['0', '(0)', "'0'", 'false', '(false)', "'false'::boolean", "b'0'"].includes(normalized);
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
