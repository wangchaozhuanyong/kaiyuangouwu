import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class AddUsdtManualRefunds1787886000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('store_usdt_manual_refund')) return;

        const tables = await Promise.all(
            ['channel', 'payment', 'order', 'refund', 'user'].map(name => queryRunner.getTable(name)),
        );
        const [channelId, paymentId, orderId, refundId, userId] = tables.map(table =>
            table?.findColumnByName('id'),
        );
        if (!channelId || !paymentId || !orderId || !refundId || !userId) {
            throw new Error('Channel, payment, order, refund and user tables must exist before USDT refunds');
        }

        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const timestampType = databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const timestampDefault = isMysql
            ? 'CURRENT_TIMESTAMP(6)'
            : isSqlite
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';

        await queryRunner.createTable(
            new Table({
                name: 'store_usdt_manual_refund',
                columns: [
                    {
                        name: 'createdAt',
                        type: timestampType,
                        ...(isMysql ? { precision: 6 } : {}),
                        isNullable: false,
                        default: timestampDefault,
                    },
                    {
                        name: 'updatedAt',
                        type: timestampType,
                        ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                        isNullable: false,
                        default: timestampDefault,
                    },
                    generatedIdColumn(channelId),
                    relationIdColumn('channelId', channelId),
                    relationIdColumn('paymentId', paymentId),
                    relationIdColumn('orderId', orderId),
                    relationIdColumn('refundId', refundId),
                    { name: 'network', type: 'varchar', length: '16', isNullable: false },
                    { name: 'transactionId', type: 'varchar', length: '64', isNullable: false },
                    {
                        name: 'usdtAmountBaseUnits',
                        type: 'decimal',
                        precision: 30,
                        scale: 0,
                        isNullable: false,
                    },
                    { name: 'fromAddress', type: 'varchar', length: '64', isNullable: false },
                    { name: 'toAddress', type: 'varchar', length: '64', isNullable: false },
                    { name: 'blockNumber', type: 'int', isNullable: false },
                    {
                        name: 'blockTimestamp',
                        type: timestampType,
                        ...(isMysql ? { precision: 6 } : {}),
                        isNullable: false,
                    },
                    relationIdColumn('operatorUserId', userId),
                    { name: 'reason', type: 'varchar', length: '500', isNullable: false },
                ],
                indices: [
                    {
                        name: 'IDX_store_usdt_manual_refund_transaction',
                        columnNames: ['network', 'transactionId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_store_usdt_manual_refund_refund',
                        columnNames: ['refundId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_store_usdt_manual_refund_channel_created',
                        columnNames: ['channelId', 'createdAt'],
                    },
                    {
                        name: 'IDX_store_usdt_manual_refund_payment',
                        columnNames: ['paymentId'],
                    },
                ],
                foreignKeys: [
                    foreignKey('channel', 'channelId'),
                    foreignKey('payment', 'paymentId'),
                    foreignKey('order', 'orderId'),
                    foreignKey('refund', 'refundId'),
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('store_usdt_manual_refund')) {
            await queryRunner.dropTable('store_usdt_manual_refund');
        }
    }
}

function generatedIdColumn(referenced: TableColumn) {
    return {
        ...idColumnType(referenced),
        name: 'id',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment' as const,
    };
}

function relationIdColumn(name: string, referenced: TableColumn) {
    return { ...idColumnType(referenced), name, isNullable: false };
}

function idColumnType(referenced: TableColumn) {
    return {
        type: referenced.type,
        ...(referenced.length ? { length: referenced.length } : {}),
        ...(referenced.width ? { width: referenced.width } : {}),
        ...(referenced.unsigned ? { unsigned: true } : {}),
    };
}

function foreignKey(table: string, column: string) {
    return {
        name: `FK_store_usdt_manual_refund_${table}`,
        columnNames: [column],
        referencedTableName: table,
        referencedColumnNames: ['id'],
    };
}
