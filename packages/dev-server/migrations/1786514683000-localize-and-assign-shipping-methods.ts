import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeAndAssignShippingMethods1786514683000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        const insertIgnore = this.isMysql(queryRunner) ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
        await queryRunner.query(`
            ${insertIgnore} INTO "shipping_method_channels_channel" ("shippingMethodId", "channelId")
            SELECT shipping_method.id, channel.id
            FROM shipping_method
            CROSS JOIN channel
            WHERE shipping_method.code IN ('standard-shipping', 'express-shipping')
              AND channel.code IN ('cn-mainland', 'my-malaysia')
        `);

        await queryRunner.query(`
            UPDATE "shipping_method_translation"
            SET "description" = 'Reliable tracked shipping for physical products.'
            WHERE "languageCode" = 'en'
              AND "baseId" = (SELECT id FROM shipping_method WHERE code = 'standard-shipping')
        `);
        await queryRunner.query(`
            UPDATE "shipping_method_translation"
            SET "description" = 'Faster tracked shipping for time-sensitive physical products.'
            WHERE "languageCode" = 'en'
              AND "baseId" = (SELECT id FROM shipping_method WHERE code = 'express-shipping')
        `);
        await queryRunner.query(`
            INSERT INTO "shipping_method_translation"
                ("languageCode", "name", "description", "baseId")
            SELECT 'zh_Hans', '标准配送', '适合普通实物订单，提供可查询的物流运输服务。', id
            FROM shipping_method
            WHERE code = 'standard-shipping'
              AND NOT EXISTS (
                  SELECT 1 FROM shipping_method_translation
                  WHERE languageCode = 'zh_Hans' AND baseId = shipping_method.id
              )
        `);
        await queryRunner.query(`
            INSERT INTO "shipping_method_translation"
                ("languageCode", "name", "description", "baseId")
            SELECT 'zh_Hans', '加急配送', '适合对送达时间有要求的实物订单，运输时效更快。', id
            FROM shipping_method
            WHERE code = 'express-shipping'
              AND NOT EXISTS (
                  SELECT 1 FROM shipping_method_translation
                  WHERE languageCode = 'zh_Hans' AND baseId = shipping_method.id
              )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        await queryRunner.query(`
            DELETE FROM "shipping_method_channels_channel"
            WHERE "shippingMethodId" IN (
                SELECT id FROM shipping_method WHERE code IN ('standard-shipping', 'express-shipping')
            )
              AND "channelId" IN (
                  SELECT id FROM channel WHERE code IN ('cn-mainland', 'my-malaysia')
              )
        `);
        await queryRunner.query(`
            DELETE FROM "shipping_method_translation"
            WHERE "languageCode" = 'zh_Hans'
              AND "baseId" IN (
                  SELECT id FROM shipping_method WHERE code IN ('standard-shipping', 'express-shipping')
              )
        `);
        await queryRunner.query(`
            UPDATE "shipping_method_translation"
            SET "description" = ''
            WHERE "languageCode" = 'en'
              AND "baseId" IN (
                  SELECT id FROM shipping_method WHERE code IN ('standard-shipping', 'express-shipping')
              )
        `);
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (this.isMysql(queryRunner)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
