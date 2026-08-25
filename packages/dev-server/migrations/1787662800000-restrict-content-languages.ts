import { MigrationInterface, QueryRunner } from 'typeorm';

const supportedLanguages = 'en,zh_Hans';

export class RestrictContentLanguages1787662800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        const parameter = this.parameter(queryRunner);

        await queryRunner.query(`UPDATE "global_settings" SET "availableLanguages" = ${parameter}`, [
            supportedLanguages,
        ]);
        await queryRunner.query(
            `UPDATE "channel"
             SET "availableLanguageCodes" = ${parameter},
                 "defaultLanguageCode" = 'zh_Hans'`,
            [supportedLanguages],
        );
        await queryRunner.query(`UPDATE "seller" SET "name" = '默认商家' WHERE "name" = 'Default Seller'`);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // The previous language selections are not recoverable safely. Existing translation rows are retained.
    }

    private parameter(queryRunner: QueryRunner): string {
        return ['postgres', 'cockroachdb'].includes(queryRunner.connection.options.type) ? '$1' : '?';
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
