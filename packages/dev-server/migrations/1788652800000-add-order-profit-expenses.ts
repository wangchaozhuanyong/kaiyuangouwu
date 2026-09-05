import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddOrderProfitExpenses1788652800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('catalog_order_profit_expense')) return;
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';

        await queryRunner.createTable(
            new Table({
                name: 'catalog_order_profit_expense',
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
                    { name: 'carrierShippingCostMicrounits', type: 'bigint', isNullable: true },
                    { name: 'paymentFeeMicrounits', type: 'bigint', isNullable: true },
                    { name: 'source', type: 'varchar', length: '24' },
                    { name: 'sourceReference', type: 'varchar', length: '64', isNullable: true },
                    { name: 'note', type: 'varchar', length: '500', isNullable: true },
                    { name: 'actorId', type: 'varchar', length: '64', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_order_profit_expense_scope',
                        columnNames: ['orderId', 'channelId', 'currencyCode'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_catalog_order_profit_expense_channel_updated',
                        columnNames: ['channelId', 'updatedAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_catalog_profit_expense_order',
                        columnNames: ['orderId'],
                        referencedTableName: 'order',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_catalog_profit_expense_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('catalog_order_profit_expense')) {
            await queryRunner.dropTable('catalog_order_profit_expense', true);
        }
    }
}
