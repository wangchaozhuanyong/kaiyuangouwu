import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeDefaultStockLocation1786516800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        await queryRunner.query(`
            UPDATE "stock_location"
            SET "name" = '默认库存点', "description" = '系统默认库存点'
            WHERE "name" IN ('Default Stock Location', '默认库存点 / Default Stock Location')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        await queryRunner.query(`
            UPDATE "stock_location"
            SET "name" = '默认库存点 / Default Stock Location', "description" = 'The default stock location'
            WHERE "name" = '默认库存点'
              AND "description" = '系统默认库存点'
        `);
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
