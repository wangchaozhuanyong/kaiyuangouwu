import { MigrationInterface, QueryRunner } from 'typeorm';

const stockColumns = ['inStock', 'productInStock'] as const;

function isTrueDefault(value: unknown): boolean {
    if (value === true || value === 1) return true;
    if (typeof value !== 'string') return false;

    const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
    return ['1', '(1)', 'true', '(true)', "'true'::boolean", "b'1'"].includes(normalized);
}

export class AlignSearchStockDefaults1787328000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('search_index_item');
        if (!table) return;

        for (const name of stockColumns) {
            const column = table.findColumnByName(name);
            if (!column || isTrueDefault(column.default)) continue;

            const updatedColumn = column.clone();
            updatedColumn.default = true;
            await queryRunner.changeColumn(table, column, updatedColumn);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('search_index_item');
        if (!table) return;

        for (const name of [...stockColumns].reverse()) {
            const column = table.findColumnByName(name);
            if (!column || column.default == null) continue;

            const updatedColumn = column.clone();
            updatedColumn.default = undefined;
            await queryRunner.changeColumn(table, column, updatedColumn);
        }
    }
}
