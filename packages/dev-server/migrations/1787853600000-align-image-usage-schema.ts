import { MigrationInterface, QueryRunner } from 'typeorm';

const AUDIT_TERMS_VERSION = '2026-08-28-audit';

export class AlignImageUsageSchema1787853600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        await this.setColumnDefault(
            queryRunner,
            'image_generation_config',
            'termsVersion',
            AUDIT_TERMS_VERSION,
        );
        await this.removeColumnDefault(queryRunner, 'image_usage_quota_bucket', 'version');
    }

    public async down(): Promise<void> {
        // This forward-only migration aligns MySQL metadata with entity definitions and preserves data.
    }

    private async setColumnDefault(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
        expectedDefault: string,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (!table || !column || this.normalizeDefault(column.default) === expectedDefault) return;

        const aligned = column.clone();
        aligned.default = `'${expectedDefault}'`;
        await queryRunner.changeColumn(table, column, aligned);
    }

    private async removeColumnDefault(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (!table || !column || column.default == null) return;

        const aligned = column.clone();
        aligned.default = undefined;
        await queryRunner.changeColumn(table, column, aligned);
    }

    private normalizeDefault(value: string | number | boolean | null | undefined): string | undefined {
        if (value == null) return undefined;

        let normalized = String(value).trim();
        while (normalized.startsWith('(') && normalized.endsWith(')')) {
            normalized = normalized.slice(1, -1).trim();
        }
        if (
            (normalized.startsWith("'") && normalized.endsWith("'")) ||
            (normalized.startsWith('"') && normalized.endsWith('"'))
        ) {
            normalized = normalized.slice(1, -1);
        }
        return normalized;
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
