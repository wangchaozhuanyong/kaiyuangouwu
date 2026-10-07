import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

/** Additive ownership: existing publications remain platform-owned (NULL). */
export class AddSystemAnnouncementOwner1791331200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('system_announcement');
        const channel = await runner.getTable('channel');
        const id = channel?.findColumnByName('id');
        if (!table || !id) throw new Error('Announcement and Channel tables must exist before ownership');
        if (!table.findColumnByName('ownerChannelId')) {
            await runner.addColumn(
                table,
                new TableColumn({
                    name: 'ownerChannelId',
                    type: id.type,
                    ...(id.length ? { length: id.length } : {}),
                    ...(id.width ? { width: id.width } : {}),
                    ...(id.unsigned ? { unsigned: true } : {}),
                    isNullable: true,
                }),
            );
        }
        const current = await runner.getTable('system_announcement');
        if (!current?.foreignKeys.some(key => key.name === 'FK_system_announcement_owner')) {
            await runner.createForeignKey(
                'system_announcement',
                new TableForeignKey({
                    name: 'FK_system_announcement_owner',
                    columnNames: ['ownerChannelId'],
                    referencedTableName: 'channel',
                    referencedColumnNames: ['id'],
                    onDelete: 'RESTRICT',
                }),
            );
        }
        if (!current?.indices.some(index => index.name === 'IDX_system_announcement_owner')) {
            await runner.createIndex(
                'system_announcement',
                new TableIndex({
                    name: 'IDX_system_announcement_owner',
                    columnNames: ['ownerChannelId'],
                }),
            );
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('system_announcement');
        if (!table?.findColumnByName('ownerChannelId')) return;
        const key = table.foreignKeys.find(item => item.name === 'FK_system_announcement_owner');
        if (key) await runner.dropForeignKey(table, key);
        const index = table.indices.find(item => item.name === 'IDX_system_announcement_owner');
        if (index) await runner.dropIndex(table, index);
        await runner.dropColumn(table, 'ownerChannelId');
    }
}
