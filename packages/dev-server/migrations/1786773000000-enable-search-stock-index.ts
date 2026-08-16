import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const stockColumns = ['inStock', 'productInStock'] as const;

export class EnableSearchStockIndex1786773000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('search_index_item');
        if (!table) return;

        for (const name of stockColumns) {
            if (!table.findColumnByName(name)) {
                await queryRunner.addColumn(table, new TableColumn({ name, type: 'boolean', default: true }));
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('search_index_item');
        if (!table) return;

        for (const name of [...stockColumns].reverse()) {
            const column = table.findColumnByName(name);
            if (column) {
                await queryRunner.dropColumn(table, column);
            }
        }
    }
}
