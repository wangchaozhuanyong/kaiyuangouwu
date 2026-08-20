import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddAfterSalesCenter1787203000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const now = isMysql
            ? 'CURRENT_TIMESTAMP(6)'
            : databaseType === 'sqlite' || databaseType === 'better-sqlite3'
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        const nullableDate = (name: string): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            isNullable: true,
        });

        if (!(await queryRunner.hasTable('after_sales_request'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'after_sales_request',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'code', type: 'varchar', length: '32' },
                        { name: 'type', type: 'varchar', length: '32' },
                        { name: 'state', type: 'varchar', length: '24', default: "'PENDING'" },
                        { name: 'reason', type: 'varchar', length: '40' },
                        { name: 'description', type: 'text' },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'requestedAmount', type: 'int' },
                        { name: 'approvedAmount', type: 'int', isNullable: true },
                        { name: 'resolution', type: 'text', isNullable: true },
                        { name: 'customerName', type: 'varchar', length: '200' },
                        { name: 'customerEmail', type: 'varchar', length: '254' },
                        nullableDate('respondedAt'),
                        nullableDate('completedAt'),
                        nullableDate('cancelledAt'),
                        { name: 'channelId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'orderId', type: idType },
                    ],
                    indices: [
                        { name: 'IDX_after_sales_request_code', columnNames: ['code'], isUnique: true },
                        {
                            name: 'IDX_after_sales_request_channel_state_created',
                            columnNames: ['channelId', 'state', 'createdAt'],
                        },
                        {
                            name: 'IDX_after_sales_request_customer_created',
                            columnNames: ['customerId', 'createdAt'],
                        },
                        { name: 'IDX_after_sales_request_order', columnNames: ['orderId'] },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_after_sales_request_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_after_sales_request_customer',
                            columnNames: ['customerId'],
                            referencedTableName: 'customer',
                            referencedColumnNames: ['id'],
                        },
                        {
                            name: 'FK_after_sales_request_order',
                            columnNames: ['orderId'],
                            referencedTableName: 'order',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('after_sales_item'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'after_sales_item',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'requestId', type: idType },
                        { name: 'orderLineId', type: idType, isNullable: true },
                        { name: 'quantity', type: 'int' },
                        { name: 'unitPriceWithTax', type: 'int' },
                        { name: 'lineAmountWithTax', type: 'int' },
                        { name: 'productName', type: 'varchar', length: '255' },
                        { name: 'sku', type: 'varchar', length: '255' },
                        { name: 'fulfillmentType', type: 'varchar', length: '16' },
                    ],
                    indices: [{ name: 'IDX_after_sales_item_request', columnNames: ['requestId'] }],
                    foreignKeys: [
                        {
                            name: 'FK_after_sales_item_request',
                            columnNames: ['requestId'],
                            referencedTableName: 'after_sales_request',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_after_sales_item_order_line',
                            columnNames: ['orderLineId'],
                            referencedTableName: 'order_line',
                            referencedColumnNames: ['id'],
                            onDelete: 'SET NULL',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('after_sales_event'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'after_sales_event',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'requestId', type: idType },
                        { name: 'state', type: 'varchar', length: '24' },
                        { name: 'actorType', type: 'varchar', length: '16' },
                        { name: 'actorLabel', type: 'varchar', length: '255' },
                        { name: 'actorId', type: 'varchar', length: '64', isNullable: true },
                        { name: 'note', type: 'text' },
                    ],
                    indices: [
                        {
                            name: 'IDX_after_sales_event_request_created',
                            columnNames: ['requestId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_after_sales_event_request',
                            columnNames: ['requestId'],
                            referencedTableName: 'after_sales_request',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of ['after_sales_event', 'after_sales_item', 'after_sales_request']) {
            if (await queryRunner.hasTable(tableName)) {
                await queryRunner.dropTable(tableName, true);
            }
        }
    }
}
