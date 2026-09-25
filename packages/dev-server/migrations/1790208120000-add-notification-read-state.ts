import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddNotificationReadState1790208120000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('store_notification_read')) return;
        const databaseType = runner.connection.options.type;
        const idType = ['postgres', 'sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType)
            ? 'integer'
            : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const mysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const now = mysql
            ? 'CURRENT_TIMESTAMP(6)'
            : ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType)
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';
        const timestamp = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(mysql ? { precision: 6 } : {}),
            default: now,
            ...(mysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        await runner.createTable(
            new Table({
                name: 'store_notification_read',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    timestamp('createdAt'),
                    timestamp('updatedAt'),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'eventKey', type: 'varchar', length: '180' },
                    { name: 'readAt', type: dateType, ...(mysql ? { precision: 6 } : {}) },
                ],
                indices: [
                    {
                        name: 'UQ_store_notification_read_identity',
                        columnNames: ['channelId', 'customerId', 'eventKey'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_store_notification_read_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_store_notification_read_customer',
                        columnNames: ['customerId'],
                        referencedTableName: 'customer',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('store_notification_read'))
            await runner.dropTable('store_notification_read', true);
    }
}
