import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

const templateColumnName = 'customFieldsIsstoreprovisioningtemplate';
const initialTemplateChannelCodes = ['__default_channel__', 'cn-mainland', 'my-malaysia'];

export class AddStoreProfileNotesAndTemplates1787500800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanFalse = databaseType === 'postgres' ? false : 0;

        const storeProfile = await queryRunner.getTable('store_profile');
        if (storeProfile && !storeProfile.findColumnByName('internalNote')) {
            await queryRunner.addColumn(
                'store_profile',
                new TableColumn({
                    name: 'internalNote',
                    type: 'text',
                    isNullable: true,
                }),
            );
        }

        const channel = await queryRunner.getTable('channel');
        if (channel && !channel.findColumnByName(templateColumnName)) {
            await queryRunner.addColumn(
                'channel',
                new TableColumn({
                    name: templateColumnName,
                    type: booleanType,
                    isNullable: false,
                    default: booleanFalse,
                }),
            );
        }

        if (channel) {
            await this.enableInitialTemplates(queryRunner);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        if (channel?.findColumnByName(templateColumnName)) {
            await queryRunner.dropColumn('channel', templateColumnName);
        }

        const storeProfile = await queryRunner.getTable('store_profile');
        if (storeProfile?.findColumnByName('internalNote')) {
            await queryRunner.dropColumn('store_profile', 'internalNote');
        }
    }

    private async enableInitialTemplates(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        if (databaseType === 'mysql' || databaseType === 'mariadb') {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
        const placeholders = initialTemplateChannelCodes.map((_, index) =>
            databaseType === 'postgres' || databaseType === 'cockroachdb' ? `$${index + 1}` : '?',
        );
        await queryRunner.query(
            `UPDATE "channel" SET "${templateColumnName}" = ${
                databaseType === 'postgres' || databaseType === 'cockroachdb' ? 'TRUE' : '1'
            } WHERE "code" IN (${placeholders.join(', ')})`,
            initialTemplateChannelCodes,
        );
    }
}
