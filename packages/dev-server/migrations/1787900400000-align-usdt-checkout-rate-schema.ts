import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const MYSQL_DATABASE_TYPES = new Set(['mysql', 'mariadb']);

export class AlignUsdtCheckoutRateSchema1787900400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!MYSQL_DATABASE_TYPES.has(queryRunner.connection.options.type)) return;

        const table = await queryRunner.getTable('storefront_usdt_checkout_quote');
        const current = table?.findColumnByName('fiatPerUsdtRate');
        if (!table || !current) return;

        const aligned = current.clone();
        aligned.type = 'float';
        aligned.precision = undefined;
        aligned.scale = undefined;
        aligned.isNullable = false;
        aligned.default = undefined;
        if (columnsMatch(current, aligned)) return;

        await queryRunner.changeColumn(table, current, aligned);
    }

    public async down(): Promise<void> {
        // This forward-only migration aligns MySQL metadata without changing stored values.
    }
}

function columnsMatch(current: TableColumn, aligned: TableColumn): boolean {
    return (
        current.type.toLowerCase() === aligned.type.toLowerCase() &&
        current.precision === aligned.precision &&
        current.scale === aligned.scale &&
        current.isNullable === aligned.isNullable &&
        normalizeDefault(current.default) === normalizeDefault(aligned.default)
    );
}

function normalizeDefault(value: string | number | boolean | null | undefined): string | undefined {
    if (value == null) return undefined;
    return String(value)
        .trim()
        .replace(/^\((.*)\)$/u, '$1')
        .replace(/^'(.*)'$/u, '$1');
}
