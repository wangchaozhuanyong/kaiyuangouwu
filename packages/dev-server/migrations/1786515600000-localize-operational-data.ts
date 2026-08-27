import { MigrationInterface, QueryRunner } from 'typeorm';

const globalNames = {
    taxCategory: [
        ['Standard Tax', '标准税类 / Standard Tax'],
        ['Reduced Tax', '优惠税类 / Reduced Tax'],
        ['Zero Tax', '零税率 / Zero Tax'],
    ],
    stockLocation: [['Default Stock Location', '默认库存点 / Default Stock Location']],
    zone: [
        ['Asia', '亚洲（Asia）'],
        ['Europe', '欧洲（Europe）'],
        ['Africa', '非洲（Africa）'],
        ['Oceania', '大洋洲（Oceania）'],
        ['Americas', '美洲（Americas）'],
    ],
    role: [
        ['SuperAdmin', '超级管理员 / Super Admin'],
        ['Customer', '客户 / Customer'],
        ['Administrator', '管理员 / Administrator'],
        ['Order manager', '订单管理员 / Order Manager'],
        ['Inventory manager', '库存管理员 / Inventory Manager'],
    ],
} as const;

const regionNameOverrides: Readonly<Record<string, string>> = {
    CN: '中国大陆',
    MY: '马来西亚',
};

export class LocalizeOperationalData1786515600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        const [firstParameter, secondParameter] = this.placeholders(queryRunner, 2);
        for (const [original, localized] of globalNames.taxCategory) {
            await queryRunner.query(
                `UPDATE "tax_category" SET "name" = ${firstParameter} WHERE "name" = ${secondParameter}`,
                [localized, original],
            );
        }
        for (const [original, localized] of globalNames.stockLocation) {
            await queryRunner.query(
                `UPDATE "stock_location" SET "name" = ${firstParameter} WHERE "name" = ${secondParameter}`,
                [localized, original],
            );
        }
        for (const [original, localized] of globalNames.zone) {
            await queryRunner.query(
                `UPDATE "zone" SET "name" = ${firstParameter} WHERE "name" = ${secondParameter}`,
                [localized, original],
            );
        }
        for (const [original, localized] of globalNames.role) {
            await queryRunner.query(
                `UPDATE "role" SET "description" = ${firstParameter} WHERE "description" = ${secondParameter}`,
                [localized, original],
            );
        }
        await queryRunner.query(`
            UPDATE "administrator"
            SET "firstName" = '超级管理员 / Super Admin', "lastName" = ''
            WHERE "emailAddress" = 'superadmin'
              AND "firstName" = 'Super'
              AND "lastName" = 'Admin'
        `);

        await queryRunner.query(`
            UPDATE "tax_rate"
            SET "name" = CASE "name"
                WHEN 'Standard Tax Asia' THEN '标准税率（亚洲）/ Standard Tax Asia'
                WHEN 'Standard Tax Europe' THEN '标准税率（欧洲）/ Standard Tax Europe'
                WHEN 'Standard Tax Africa' THEN '标准税率（非洲）/ Standard Tax Africa'
                WHEN 'Standard Tax Oceania' THEN '标准税率（大洋洲）/ Standard Tax Oceania'
                WHEN 'Standard Tax Americas' THEN '标准税率（美洲）/ Standard Tax Americas'
                WHEN 'Reduced Tax Asia' THEN '优惠税率（亚洲）/ Reduced Tax Asia'
                WHEN 'Reduced Tax Europe' THEN '优惠税率（欧洲）/ Reduced Tax Europe'
                WHEN 'Reduced Tax Africa' THEN '优惠税率（非洲）/ Reduced Tax Africa'
                WHEN 'Reduced Tax Oceania' THEN '优惠税率（大洋洲）/ Reduced Tax Oceania'
                WHEN 'Reduced Tax Americas' THEN '优惠税率（美洲）/ Reduced Tax Americas'
                WHEN 'Zero Tax Asia' THEN '零税率（亚洲）/ Zero Tax Asia'
                WHEN 'Zero Tax Europe' THEN '零税率（欧洲）/ Zero Tax Europe'
                WHEN 'Zero Tax Africa' THEN '零税率（非洲）/ Zero Tax Africa'
                WHEN 'Zero Tax Oceania' THEN '零税率（大洋洲）/ Zero Tax Oceania'
                WHEN 'Zero Tax Americas' THEN '零税率（美洲）/ Zero Tax Americas'
                ELSE "name"
            END
        `);

        await queryRunner.query(`
            UPDATE "payment_method_translation"
            SET "name" = 'Standard Payment',
                "description" = 'Default payment method for local testing.'
            WHERE "languageCode" = 'en'
              AND "baseId" = (SELECT "id" FROM "payment_method" WHERE "code" = 'standard-payment')
        `);
        await queryRunner.query(`
            INSERT INTO "payment_method_translation" ("languageCode", "name", "description", "baseId")
            SELECT 'zh_Hans', '标准支付', '用于本地测试的默认支付方式。', id
            FROM "payment_method"
            WHERE "code" = 'standard-payment'
              AND NOT EXISTS (
                  SELECT 1 FROM "payment_method_translation"
                  WHERE "languageCode" = 'zh_Hans'
                    AND "baseId" = "payment_method"."id"
              )
        `);

        await queryRunner.query(`
            UPDATE "promotion_translation"
            SET "name" = 'Demo promotion (disabled)',
                "description" = 'Disabled sample promotion retained for configuration testing.'
            WHERE "languageCode" = 'en' AND "baseId" = 1 AND "name" = ''
        `);
        await queryRunner.query(`
            INSERT INTO "promotion_translation" ("languageCode", "name", "description", "baseId")
            SELECT 'zh_Hans', '示例促销（已停用）', '用于配置测试的已停用示例促销。', id
            FROM "promotion"
            WHERE "id" = 1
              AND NOT EXISTS (
                  SELECT 1 FROM "promotion_translation"
                  WHERE "languageCode" = 'zh_Hans' AND "baseId" = "promotion"."id"
              )
        `);

        const regionDisplayNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
        const regions: Array<{ code: string }> = await queryRunner.query(
            `SELECT "code" FROM "region" WHERE "type" = 'country'`,
        );
        for (const { code } of regions) {
            const name = regionNameOverrides[code] ?? regionDisplayNames.of(code);
            if (!name || name === code) {
                continue;
            }
            const [nameParameter, codeParameter] = this.placeholders(queryRunner, 2);
            await queryRunner.query(
                `
                    INSERT INTO "region_translation" ("languageCode", "name", "baseId")
                    SELECT 'zh_Hans', ${nameParameter}, "id"
                    FROM "region"
                    WHERE "code" = ${codeParameter}
                      AND NOT EXISTS (
                          SELECT 1 FROM "region_translation"
                          WHERE "languageCode" = 'zh_Hans' AND "baseId" = "region"."id"
                      )
                `,
                [name, code],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        const [firstParameter, secondParameter] = this.placeholders(queryRunner, 2);
        for (const [original, localized] of globalNames.taxCategory) {
            await queryRunner.query(
                `UPDATE "tax_category" SET "name" = ${firstParameter} WHERE "name" = ${secondParameter}`,
                [original, localized],
            );
        }
        for (const [original, localized] of globalNames.stockLocation) {
            await queryRunner.query(
                `UPDATE "stock_location" SET "name" = ${firstParameter} WHERE "name" = ${secondParameter}`,
                [original, localized],
            );
        }
        for (const [original, localized] of globalNames.zone) {
            await queryRunner.query(
                `UPDATE "zone" SET "name" = ${firstParameter} WHERE "name" = ${secondParameter}`,
                [original, localized],
            );
        }
        for (const [original, localized] of globalNames.role) {
            await queryRunner.query(
                `UPDATE "role" SET "description" = ${firstParameter} WHERE "description" = ${secondParameter}`,
                [original, localized],
            );
        }
        await queryRunner.query(`
            UPDATE "administrator"
            SET "firstName" = 'Super', "lastName" = 'Admin'
            WHERE "emailAddress" = 'superadmin'
              AND "firstName" = '超级管理员 / Super Admin'
              AND "lastName" = ''
        `);

        await queryRunner.query(`
            UPDATE "tax_rate"
            SET "name" = CASE "name"
                WHEN '标准税率（亚洲）/ Standard Tax Asia' THEN 'Standard Tax Asia'
                WHEN '标准税率（欧洲）/ Standard Tax Europe' THEN 'Standard Tax Europe'
                WHEN '标准税率（非洲）/ Standard Tax Africa' THEN 'Standard Tax Africa'
                WHEN '标准税率（大洋洲）/ Standard Tax Oceania' THEN 'Standard Tax Oceania'
                WHEN '标准税率（美洲）/ Standard Tax Americas' THEN 'Standard Tax Americas'
                WHEN '优惠税率（亚洲）/ Reduced Tax Asia' THEN 'Reduced Tax Asia'
                WHEN '优惠税率（欧洲）/ Reduced Tax Europe' THEN 'Reduced Tax Europe'
                WHEN '优惠税率（非洲）/ Reduced Tax Africa' THEN 'Reduced Tax Africa'
                WHEN '优惠税率（大洋洲）/ Reduced Tax Oceania' THEN 'Reduced Tax Oceania'
                WHEN '优惠税率（美洲）/ Reduced Tax Americas' THEN 'Reduced Tax Americas'
                WHEN '零税率（亚洲）/ Zero Tax Asia' THEN 'Zero Tax Asia'
                WHEN '零税率（欧洲）/ Zero Tax Europe' THEN 'Zero Tax Europe'
                WHEN '零税率（非洲）/ Zero Tax Africa' THEN 'Zero Tax Africa'
                WHEN '零税率（大洋洲）/ Zero Tax Oceania' THEN 'Zero Tax Oceania'
                WHEN '零税率（美洲）/ Zero Tax Americas' THEN 'Zero Tax Americas'
                ELSE "name"
            END
        `);
        await queryRunner.query(`
            DELETE FROM "payment_method_translation"
            WHERE "languageCode" = 'zh_Hans'
              AND "baseId" = (SELECT "id" FROM "payment_method" WHERE "code" = 'standard-payment')
        `);
        await queryRunner.query(`
            UPDATE "payment_method_translation"
            SET "description" = ''
            WHERE "languageCode" = 'en'
              AND "baseId" = (SELECT id FROM payment_method WHERE code = 'standard-payment')
        `);
        await queryRunner.query(
            `DELETE FROM "promotion_translation" WHERE "languageCode" = 'zh_Hans' AND "baseId" = 1`,
        );
        await queryRunner.query(`
            UPDATE "promotion_translation"
            SET "name" = '', "description" = ''
            WHERE "languageCode" = 'en' AND "baseId" = 1
        `);
        await queryRunner.query(`
            DELETE FROM "region_translation"
            WHERE "languageCode" = 'zh_Hans'
        `);
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }

    private placeholders(queryRunner: QueryRunner, count: number): string[] {
        if (['postgres', 'cockroachdb'].includes(queryRunner.connection.options.type)) {
            return Array.from({ length: count }, (_, index) => `$${index + 1}`);
        }
        return Array.from({ length: count }, () => '?');
    }
}
