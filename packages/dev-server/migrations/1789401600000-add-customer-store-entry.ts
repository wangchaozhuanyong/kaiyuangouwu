import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddCustomerStoreEntry1789401600000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const customer = await runner.getTable('customer');
        const channel = await runner.getTable('channel');
        const customerId = customer?.columns.find(column => column.name === 'id');
        const channelId = channel?.columns.find(column => column.name === 'id');
        if (!customerId || !channelId)
            throw new Error('Customer and Channel are required for store entry history');
        const existing = await runner.getTable('customer_store_entry');
        if (existing) {
            if (
                !['id', 'customerId', 'channelId', 'firstSeenAt', 'source', 'createdAt', 'updatedAt'].every(
                    name => existing.findColumnByName(name),
                )
            ) {
                throw new Error(
                    'Existing customer_store_entry schema is incomplete; review before continuing',
                );
            }
            if (
                !existing.indices.some(index => index.name === 'UQ_customer_store_entry' && index.isUnique) ||
                existing.foreignKeys.length < 2
            )
                throw new Error('Existing store entry ownership constraints are incomplete');
            return;
        }
        const type = runner.connection.options.type;
        const dateType = ['postgres', 'aurora-postgres'].includes(type)
            ? 'timestamp without time zone'
            : 'datetime';
        const identity = customerId.clone();
        identity.name = 'id';
        const reference = (name: string, column: typeof customerId) => ({
            name,
            type: column.type,
            length: column.length,
            unsigned: column.unsigned,
        });
        await runner.createTable(
            new Table({
                name: 'customer_store_entry',
                columns: [
                    identity,
                    { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    reference('customerId', customerId),
                    reference('channelId', channelId),
                    { name: 'firstSeenAt', type: dateType, isNullable: true },
                    { name: 'source', type: 'varchar', length: '32' },
                ],
                indices: [
                    {
                        name: 'UQ_customer_store_entry',
                        columnNames: ['customerId', 'channelId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_customer_store_entry_customer',
                        columnNames: ['customerId'],
                        referencedTableName: 'customer',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                    {
                        name: 'FK_customer_store_entry_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                ],
            }),
        );
        // No backfill from Customer.createdAt or channel membership: neither proves first entry.
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain store entry and newcomer history during application rollback'),
        );
    }
}
