import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const resolutionColumns = ['resolutionZh', 'resolutionEn'] as const;

function isMysql(queryRunner: QueryRunner): boolean {
    return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
}

function isTrueDefault(value: unknown): boolean {
    if (value === true || value === 1) return true;
    if (typeof value !== 'string') return false;

    const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
    return ['1', '(1)', "'1'", 'true', '(true)', "'true'::boolean", "b'1'"].includes(normalized);
}

export class AlignAfterSalesAutoCardSchema1787680800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.addBilingualResolutionColumns(queryRunner);
        await this.alignAutoCardEnabledColumn(queryRunner);
    }

    public async down(): Promise<void> {
        // This migration repairs an existing schema drift. Reverting it would either
        // reintroduce the drift or delete bilingual after-sales resolution content.
    }

    private async addBilingualResolutionColumns(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('after_sales_request');
        if (!table) return;

        for (const name of resolutionColumns) {
            if (table.findColumnByName(name)) continue;

            const column = new TableColumn({ name, type: 'text', isNullable: true });
            await queryRunner.addColumn(table, column);
        }
    }

    private async alignAutoCardEnabledColumn(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('auto_card_config');
        const column = table?.findColumnByName('enabled');
        if (!table || !column) return;

        const mysql = isMysql(queryRunner);
        const expectedType = mysql ? 'tinyint' : 'boolean';
        const hasExpectedMetadata =
            column.type.toLowerCase() === expectedType &&
            !column.isNullable &&
            isTrueDefault(column.default) &&
            (!mysql || column.width === undefined);
        if (hasExpectedMetadata) return;

        const updatedColumn = column.clone();
        updatedColumn.type = expectedType;
        updatedColumn.isNullable = false;
        updatedColumn.default = mysql ? 1 : true;
        if (mysql) updatedColumn.width = undefined;
        await queryRunner.changeColumn(table, column, updatedColumn);
    }
}
