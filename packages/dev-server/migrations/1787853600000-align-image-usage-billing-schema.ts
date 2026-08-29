import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const AUDIT_TERMS_VERSION = "'2026-08-28-audit'";

export class AlignImageUsageBillingSchema1787853600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        await this.alignColumn(queryRunner, 'image_generation_config', 'termsVersion', column => {
            column.type = 'varchar';
            column.length = '32';
            column.isNullable = false;
            column.default = AUDIT_TERMS_VERSION;
        });
        await this.alignColumn(queryRunner, 'image_usage_quota_bucket', 'version', column => {
            column.type = 'int';
            column.isNullable = false;
            column.default = undefined;
        });
    }

    public async down(): Promise<void> {
        // This data-preserving migration aligns MySQL metadata with the entity definitions.
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
            current.length === expected.length &&
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
