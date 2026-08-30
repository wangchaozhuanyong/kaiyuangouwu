import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class ScopeSystemAnnouncements1787878800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const announcementTable = await queryRunner.getTable('system_announcement');
        const channelTable = await queryRunner.getTable('channel');
        if (!announcementTable || !channelTable) {
            throw new Error('system_announcement and channel tables must exist before Channel scoping');
        }

        if (!announcementTable.findColumnByName('targetMode')) {
            await queryRunner.addColumn(
                announcementTable,
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

        const announcementId = announcementTable.findColumnByName('id');
        const channelId = channelTable.findColumnByName('id');
        if (!announcementId || !channelId) {
            throw new Error('system_announcement.id and channel.id must exist before Channel scoping');
        }

        await queryRunner.createTable(
            new Table({
                name: 'system_announcement_channels_channel',
                columns: [
                    relationIdColumn('systemAnnouncementId', announcementId),
                    relationIdColumn('channelId', channelId),
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
        const announcementTable = await queryRunner.getTable('system_announcement');
        if (announcementTable?.findColumnByName('targetMode')) {
            await queryRunner.dropColumn(announcementTable, 'targetMode');
        }
    }
}

function relationIdColumn(name: string, referenced: TableColumn) {
    return {
        name,
        type: referenced.type,
        ...(referenced.length ? { length: referenced.length } : {}),
        ...(referenced.width ? { width: referenced.width } : {}),
        ...(referenced.unsigned ? { unsigned: true } : {}),
        isPrimary: true,
        isNullable: false,
    };
}
