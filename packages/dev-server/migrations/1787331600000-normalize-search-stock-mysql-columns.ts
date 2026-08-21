import { MigrationInterface, QueryRunner } from 'typeorm';

const stockColumns = ['inStock', 'productInStock'] as const;

function isMysql(queryRunner: QueryRunner): boolean {
    return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
}

export class NormalizeSearchStockMysqlColumns1787331600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!isMysql(queryRunner)) return;

        const table = await queryRunner.getTable('search_index_item');
        if (!table) return;

        for (const name of stockColumns) {
            const column = table.findColumnByName(name);
            if (!column) continue;

            const updatedColumn = column.clone();
            updatedColumn.type = 'tinyint';
            updatedColumn.width = undefined;
            updatedColumn.default = 1;
            updatedColumn.isNullable = false;
            await queryRunner.changeColumn(table, column, updatedColumn);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!isMysql(queryRunner)) return;

        const table = await queryRunner.getTable('search_index_item');
        if (!table) return;

        for (const name of [...stockColumns].reverse()) {
            const column = table.findColumnByName(name);
            if (!column) continue;

            const updatedColumn = column.clone();
            updatedColumn.type = 'tinyint';
            updatedColumn.width = 1;
            updatedColumn.default = 1;
            updatedColumn.isNullable = false;
            await queryRunner.changeColumn(table, column, updatedColumn);
        }
    }
}
