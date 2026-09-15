import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class AddCustomerGroupChannel1789398000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('customer_group');
        const channel = await runner.getTable('channel');
        const channelId = channel?.columns.find(column => column.name === 'id');
        if (!table || !channelId)
            throw new Error('CustomerGroup and Channel are required before assigning group ownership');
        const existing = table.columns.find(column => column.name === 'channelId');
        if (existing && (existing.type !== channelId.type || !existing.isNullable)) {
            throw new Error('Existing CustomerGroup.channelId must match a nullable Channel identity');
        }
        if (!existing)
            await runner.addColumn(
                table,
                new TableColumn({
                    name: 'channelId',
                    type: channelId.type,
                    length: channelId.length,
                    unsigned: channelId.unsigned,
                    isNullable: true,
                }),
            );
        const refreshed = await runner.getTable('customer_group');
        if (!refreshed) throw new Error('CustomerGroup table disappeared during migration');
        if (!refreshed.indices.some(index => index.name === 'IDX_customer_group_channel')) {
            await runner.createIndex(
                refreshed,
                new TableIndex({
                    name: 'IDX_customer_group_channel',
                    columnNames: ['channelId'],
                }),
            );
        }
        if (!refreshed.foreignKeys.some(key => key.columnNames.includes('channelId'))) {
            await runner.createForeignKey(
                refreshed,
                new TableForeignKey({
                    name: 'FK_customer_group_channel',
                    columnNames: ['channelId'],
                    referencedTableName: 'channel',
                    referencedColumnNames: ['id'],
                    onDelete: 'RESTRICT',
                }),
            );
        }
    }
    down(): Promise<void> {
        return Promise.reject(new Error('Retain store group ownership during application rollback'));
    }
}
