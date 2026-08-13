import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeDefaultStockLocation1786516800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "stock_location"
            SET "name" = '默认库存点', "description" = '系统默认库存点'
            WHERE "name" IN ('Default Stock Location', '默认库存点 / Default Stock Location')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "stock_location"
            SET "name" = '默认库存点 / Default Stock Location', "description" = 'The default stock location'
            WHERE "name" = '默认库存点'
              AND "description" = '系统默认库存点'
        `);
    }
}
