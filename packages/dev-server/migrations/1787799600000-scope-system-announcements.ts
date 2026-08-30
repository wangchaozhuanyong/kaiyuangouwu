import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class ScopeSystemAnnouncements1787799600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('system_announcement'))) return;

        const table = await queryRunner.getTable('system_announcement');
        if (!table?.findColumnByName('targetMode')) {
            await queryRunner.addColumn(
                'system_announcement',
                new TableColumn({
                    name: 'targetMode',
                    type: 'varchar',
                    length: '16',
                    isNullable: false,
                    default: "'ALL'",
                }),
            );
        }
        if (await queryRunner.hasTable('system_announcement_channels_channel')) return;

        const databaseType = queryRunner.connection.options.type;
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        await queryRunner.createTable(
            new Table({
                name: 'system_announcement_channels_channel',
                columns: [
                    { name: 'systemAnnouncementId', type: idType, isPrimary: true },
                    { name: 'channelId', type: idType, isPrimary: true },
                ],
                indices: [
                    {
                        name: 'IDX_system_announcement_channels_announcement',
                        columnNames: ['systemAnnouncementId'],
                    },
                    {
                        name: 'IDX_system_announcement_channels_channel',
                        columnNames: ['channelId'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_system_announcement_channels_announcement',
                        columnNames: ['systemAnnouncementId'],
                        referencedTableName: 'system_announcement',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_system_announcement_channels_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('system_announcement_channels_channel')) {
            await queryRunner.dropTable('system_announcement_channels_channel');
        }
        const table = await queryRunner.getTable('system_announcement');
        if (table?.findColumnByName('targetMode')) {
            await queryRunner.dropColumn('system_announcement', 'targetMode');
        }
    }
}
