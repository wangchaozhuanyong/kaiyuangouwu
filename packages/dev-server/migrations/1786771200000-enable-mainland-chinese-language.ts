import { MigrationInterface, QueryRunner } from 'typeorm';

const mainlandChineseLanguageCode = 'zh_Hans';

interface GlobalSettingsLanguageRow {
    id: string | number;
    availableLanguages: string;
}

export class EnableMainlandChineseLanguage1786771200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);

        const rows = (await queryRunner.query(
            `SELECT "id", "availableLanguages" FROM "global_settings"`,
        )) as GlobalSettingsLanguageRow[];

        for (const row of rows) {
            const availableLanguages = row.availableLanguages
                .split(',')
                .map(languageCode => languageCode.trim())
                .filter(Boolean);
            if (availableLanguages.includes(mainlandChineseLanguageCode)) {
                continue;
            }

            const parameters = this.parameters(queryRunner);
            await queryRunner.query(
                `UPDATE "global_settings" SET "availableLanguages" = ${parameters[0]} WHERE "id" = ${parameters[1]}`,
                [[...availableLanguages, mainlandChineseLanguageCode].join(','), row.id],
            );
        }
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Regional Channels depend on zh_Hans, so rollback must not remove it globally.
    }

    private parameters(queryRunner: QueryRunner): [string, string] {
        return ['postgres', 'cockroachdb'].includes(queryRunner.connection.options.type)
            ? ['$1', '$2']
            : ['?', '?'];
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
