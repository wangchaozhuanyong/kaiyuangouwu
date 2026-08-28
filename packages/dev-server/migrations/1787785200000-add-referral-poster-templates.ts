import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddReferralPosterTemplates1787785200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanTrue = databaseType === 'postgres' ? true : 1;

        const config = await queryRunner.getTable('referral_program_config');
        const defaultTemplate = config?.findColumnByName('defaultPosterTemplate');
        if (config && defaultTemplate && defaultTemplate.length !== '64') {
            const updatedColumn = defaultTemplate.clone();
            updatedColumn.type = 'varchar';
            updatedColumn.length = '64';
            await queryRunner.changeColumn(config, defaultTemplate, updatedColumn);
        }

        if (await queryRunner.hasTable('referral_poster_template')) return;
        const timestamp = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        await queryRunner.createTable(
            new Table({
                name: 'referral_poster_template',
                columns: [
                    timestamp('createdAt'),
                    timestamp('updatedAt'),
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'channelId', type: idType },
                    { name: 'name', type: 'varchar', length: '128' },
                    { name: 'enabled', type: booleanType, default: booleanTrue },
                    { name: 'position', type: 'int', default: 0 },
                    { name: 'layoutVariant', type: 'varchar', length: '32', default: "'STANDARD_CENTER'" },
                    { name: 'posterBackgroundAssetId', type: idType, isNullable: true },
                    { name: 'shareBackgroundAssetId', type: idType, isNullable: true },
                    { name: 'titleZh', type: 'varchar', length: '80', default: "'好友邀请函'" },
                    {
                        name: 'titleEn',
                        type: 'varchar',
                        length: '80',
                        default: "'Invitation for friends'",
                    },
                    {
                        name: 'headlineZh',
                        type: 'varchar',
                        length: '180',
                        default: "'发现好东西，一起分享'",
                    },
                    {
                        name: 'headlineEn',
                        type: 'varchar',
                        length: '180',
                        default: "'Discover something worth sharing'",
                    },
                    {
                        name: 'rewardTextZh',
                        type: 'varchar',
                        length: '220',
                        default: "'好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣'",
                    },
                    {
                        name: 'rewardTextEn',
                        type: 'varchar',
                        length: '220',
                        default: "'Earn {rewardRate}% in rewards when a friend makes a purchase'",
                    },
                    { name: 'siteIntroZh', type: 'varchar', length: '260', default: "''" },
                    { name: 'siteIntroEn', type: 'varchar', length: '260', default: "''" },
                    {
                        name: 'serviceTextZh',
                        type: 'varchar',
                        length: '260',
                        default: "'好物严选 · 便捷消费 · 售后服务'",
                    },
                    {
                        name: 'serviceTextEn',
                        type: 'varchar',
                        length: '260',
                        default: "'Curated products · Easy shopping · Customer support'",
                    },
                    { name: 'foregroundColor', type: 'varchar', length: '16', default: "'#FFFFFF'" },
                    { name: 'accentColor', type: 'varchar', length: '16', default: "'#FF4D4F'" },
                    { name: 'overlayOpacity', type: 'int', default: 28 },
                ],
                indices: [
                    {
                        name: 'IDX_referral_poster_template_channel_position',
                        columnNames: ['channelId', 'position'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_referral_poster_template_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_referral_poster_template_poster_asset',
                        columnNames: ['posterBackgroundAssetId'],
                        referencedTableName: 'asset',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                    {
                        name: 'FK_referral_poster_template_share_asset',
                        columnNames: ['shareBackgroundAssetId'],
                        referencedTableName: 'asset',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('referral_poster_template')) {
            await queryRunner.dropTable('referral_poster_template', true);
        }
    }
}
