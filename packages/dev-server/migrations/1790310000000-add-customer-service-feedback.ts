import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddCustomerServiceFeedback1790310000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('customer_service_feedback')) return;
        const type = runner.connection.options.type;
        const mysql = type === 'mysql' || type === 'mariadb';
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
        const idType = sqlite || type === 'postgres' ? 'integer' : 'int';
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const date = (name: string): TableColumnOptions => ({
            name,
            type: dateType,
            ...(mysql ? { precision: 6 } : {}),
            default: mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP',
            ...(mysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        await runner.createTable(
            new Table({
                name: 'customer_service_feedback',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    date('createdAt'),
                    date('updatedAt'),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'orderId', type: idType, isNullable: true },
                    { name: 'scopeKey', type: 'varchar', length: '80' },
                    { name: 'orderCode', type: 'varchar', length: '80', isNullable: true },
                    { name: 'rating', type: 'int' },
                    { name: 'tagsJson', type: 'text' },
                    { name: 'comment', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'UQ_customer_service_feedback_scope',
                        columnNames: ['channelId', 'customerId', 'scopeKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_customer_service_feedback_channel_updated',
                        columnNames: ['channelId', 'updatedAt'],
                    },
                ],
                foreignKeys: [
                    ['channel', 'channel'],
                    ['customer', 'customer'],
                    ['order', 'order'],
                ].map(([field, table]) => ({
                    name: `FK_customer_service_feedback_${field}`,
                    columnNames: [`${field}Id`],
                    referencedTableName: table,
                    referencedColumnNames: ['id'],
                    onDelete: 'CASCADE',
                })),
            }),
            true,
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('customer_service_feedback')) {
            await runner.dropTable('customer_service_feedback', true);
        }
    }
}
