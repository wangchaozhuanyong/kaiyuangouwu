import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

const tableName = 'system_announcement_channels_channel';
const announcementIndex = {
    legacy: 'IDX_system_announcement_channels_announcement',
    current: 'IDX_aa074cb9061687d3e3b2bc7fc8',
    columnNames: ['systemAnnouncementId'],
};
const channelIndex = {
    legacy: 'IDX_system_announcement_channels_channel',
    current: 'IDX_adcdad637ed68b4349d68d6a6c',
    columnNames: ['channelId'],
};

export class AlignChannelUsdtSchema1787889600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await alignIndex(
            queryRunner,
            announcementIndex.legacy,
            announcementIndex.current,
            announcementIndex.columnNames,
        );
        await alignIndex(queryRunner, channelIndex.legacy, channelIndex.current, channelIndex.columnNames);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await alignIndex(
            queryRunner,
            announcementIndex.current,
            announcementIndex.legacy,
            announcementIndex.columnNames,
        );
        await alignIndex(queryRunner, channelIndex.current, channelIndex.legacy, channelIndex.columnNames);
    }
}

async function alignIndex(
    queryRunner: QueryRunner,
    obsoleteName: string,
    expectedName: string,
    columnNames: string[],
): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table) throw new Error(`${tableName} must exist before aligning Channel and USDT schema`);
    const obsolete = table.indices.find(index => index.name === obsoleteName);
    const expected = table.indices.find(index => index.name === expectedName);

    if (obsolete) await queryRunner.dropIndex(tableName, obsolete);
    if (!expected) {
        await queryRunner.createIndex(
            tableName,
            new TableIndex({ name: expectedName, columnNames, isUnique: false }),
        );
    }
}
