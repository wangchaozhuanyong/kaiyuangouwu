import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class CloseFulfillmentDelivery1789599600000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const databaseType = String(runner.connection.options.type);
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const baseColumns = (): TableColumnOptions[] => [
            { name: 'createdAt', type: dateType, ...(isMysql ? { precision: 6 } : {}), default: now },
            {
                name: 'updatedAt',
                type: dateType,
                ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                default: now,
            },
            { name: 'id', type: idType, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        ];

        await createIfMissing(
            runner,
            new Table({
                name: 'fulfillment_delivery_record',
                columns: [
                    ...baseColumns(),
                    { name: 'fulfillmentId', type: idType },
                    { name: 'orderId', type: idType },
                    { name: 'channelId', type: idType },
                    { name: 'status', type: 'varchar', length: '24' },
                    { name: 'carrier', type: 'varchar', length: '120' },
                    { name: 'trackingCode', type: 'varchar', length: '160' },
                    { name: 'exceptionReason', type: 'text', isNullable: true },
                    { name: 'proofReference', type: 'varchar', length: '255', isNullable: true },
                    { name: 'shippedAt', type: dateType },
                    { name: 'deliveredAt', type: dateType, isNullable: true },
                    { name: 'nextActionDueAt', type: dateType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'UQ_fulfillment_delivery_fulfillment',
                        columnNames: ['fulfillmentId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_fulfillment_delivery_channel_status',
                        columnNames: ['channelId', 'status', 'nextActionDueAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_fulfillment_delivery_fulfillment',
                        columnNames: ['fulfillmentId'],
                        referencedTableName: 'fulfillment',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_fulfillment_delivery_order',
                        columnNames: ['orderId'],
                        referencedTableName: 'order',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_fulfillment_delivery_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
        );

        await createIfMissing(
            runner,
            new Table({
                name: 'fulfillment_delivery_event',
                columns: [
                    ...baseColumns(),
                    { name: 'recordId', type: idType },
                    { name: 'status', type: 'varchar', length: '24' },
                    { name: 'idempotencyKey', type: 'varchar', length: '80' },
                    { name: 'actorType', type: 'varchar', length: '16' },
                    { name: 'actorLabel', type: 'varchar', length: '255' },
                    { name: 'actorId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'note', type: 'text' },
                    { name: 'carrier', type: 'varchar', length: '120' },
                    { name: 'trackingCode', type: 'varchar', length: '160' },
                    { name: 'proofReference', type: 'varchar', length: '255', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_fulfillment_delivery_event_record_created',
                        columnNames: ['recordId', 'createdAt'],
                    },
                    {
                        name: 'IDX_fulfillment_delivery_event_record_key',
                        columnNames: ['recordId', 'idempotencyKey'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_fulfillment_delivery_event_record',
                        columnNames: ['recordId'],
                        referencedTableName: 'fulfillment_delivery_record',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain fulfillment carrier, exception, and delivery evidence'));
    }
}

async function createIfMissing(runner: QueryRunner, table: Table): Promise<void> {
    if (!(await runner.hasTable(table.name))) await runner.createTable(table);
}
