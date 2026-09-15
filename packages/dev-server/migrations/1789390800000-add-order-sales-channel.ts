import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

/** Expand only. Historical ownership requires a separately reviewed evidence mapping. */
export class AddOrderSalesChannel1789390800000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const order = await runner.getTable('order');
        const channel = await runner.getTable('channel');
        const channelId = channel?.columns.find(column => column.name === 'id');
        if (!order || !channelId)
            throw new Error('Order and Channel tables must exist before adding sales ownership');
        const existing = order.columns.find(column => column.name === 'salesChannelId');
        if (existing && (existing.type !== channelId.type || !existing.isNullable)) {
            throw new Error('Existing order.salesChannelId does not match the nullable Channel identity');
        }
        if (!existing) {
            await runner.addColumn(
                order,
                new TableColumn({
                    name: 'salesChannelId',
                    type: channelId.type,
                    length: channelId.length,
                    unsigned: channelId.unsigned,
                    isNullable: true,
                }),
            );
        }
        const refreshed = await runner.getTable('order');
        if (!refreshed) throw new Error('Order table disappeared during sales ownership migration');
        if (!refreshed.indices.some(index => index.name === 'IDX_order_sales_channel')) {
            await runner.createIndex(
                refreshed,
                new TableIndex({
                    name: 'IDX_order_sales_channel',
                    columnNames: ['salesChannelId'],
                }),
            );
        }
        if (!refreshed.foreignKeys.some(key => key.columnNames.includes('salesChannelId'))) {
            await runner.createForeignKey(
                refreshed,
                new TableForeignKey({
                    name: 'FK_order_sales_channel',
                    columnNames: ['salesChannelId'],
                    referencedTableName: 'channel',
                    referencedColumnNames: ['id'],
                    onDelete: 'RESTRICT',
                }),
            );
        }
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain order sales ownership during application rollback'));
    }
}
