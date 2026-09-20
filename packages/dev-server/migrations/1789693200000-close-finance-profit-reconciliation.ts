import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

export class CloseFinanceProfitReconciliation1789693200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const databaseType = String(runner.connection.options.type);
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        if (
            (await runner.hasTable('catalog_order_profit_expense')) &&
            !(await runner.hasColumn('catalog_order_profit_expense', 'chargebackMicrounits'))
        ) {
            await runner.addColumn(
                'catalog_order_profit_expense',
                new TableColumn({ name: 'chargebackMicrounits', type: 'bigint', isNullable: true }),
            );
        }
        if (!(await runner.hasTable('catalog_order_profit_expense_event'))) {
            await runner.createTable(
                new Table({
                    name: 'catalog_order_profit_expense_event',
                    columns: [
                        {
                            name: 'createdAt',
                            type: dateType,
                            ...(isMysql ? { precision: 6 } : {}),
                            default: now,
                        },
                        {
                            name: 'updatedAt',
                            type: dateType,
                            ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                            default: now,
                        },
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        { name: 'orderId', type: idType },
                        { name: 'channelId', type: idType },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'eventType', type: 'varchar', length: '24' },
                        { name: 'idempotencyKey', type: 'varchar', length: '96' },
                        { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'sourceReference', type: 'varchar', length: '64', isNullable: true },
                        { name: 'beforeJson', type: 'text', isNullable: true },
                        { name: 'afterJson', type: 'text' },
                    ],
                    indices: [
                        {
                            name: 'UQ_catalog_profit_expense_event_key',
                            columnNames: ['channelId', 'idempotencyKey'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_catalog_profit_expense_event_order',
                            columnNames: ['channelId', 'orderId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_catalog_profit_expense_event_order',
                            columnNames: ['orderId'],
                            referencedTableName: 'order',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_catalog_profit_expense_event_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
        }
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain chargeback values and append-only finance reconciliation evidence'),
        );
    }
}
