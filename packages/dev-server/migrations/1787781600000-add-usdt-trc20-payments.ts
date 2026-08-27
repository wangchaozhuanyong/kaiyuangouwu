import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddUsdtTrc20Payments1787781600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_usdt_payment_intent')) return;

        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const timestampType = databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const timestampPrecision = isMysql ? { precision: 6 } : {};

        await queryRunner.createTable(
            new Table({
                name: 'storefront_usdt_payment_intent',
                columns: [
                    {
                        name: 'createdAt',
                        type: timestampType,
                        ...timestampPrecision,
                        isNullable: false,
                        default: now,
                    },
                    {
                        name: 'updatedAt',
                        type: timestampType,
                        ...timestampPrecision,
                        isNullable: false,
                        default: now,
                        ...(isMysql ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                    },
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'channelId', type: idType, isNullable: false },
                    { name: 'orderId', type: idType, isNullable: false },
                    { name: 'quoteId', type: idType, isNullable: false },
                    { name: 'paymentId', type: idType, isNullable: true },
                    { name: 'network', type: 'varchar', length: '16', isNullable: false },
                    { name: 'tokenContractAddress', type: 'varchar', length: '64', isNullable: false },
                    { name: 'receivingAddress', type: 'varchar', length: '64', isNullable: false },
                    {
                        name: 'receivingAddressFingerprint',
                        type: 'varchar',
                        length: '64',
                        isNullable: false,
                    },
                    { name: 'matchKey', type: 'varchar', length: '64', isNullable: false },
                    {
                        name: 'baseUsdtAmount',
                        type: 'decimal',
                        precision: 24,
                        scale: 6,
                        isNullable: false,
                    },
                    {
                        name: 'expectedUsdtAmount',
                        type: 'decimal',
                        precision: 24,
                        scale: 6,
                        isNullable: false,
                    },
                    {
                        name: 'status',
                        type: 'varchar',
                        length: '24',
                        isNullable: false,
                        default: "'PENDING'",
                    },
                    {
                        name: 'transactionId',
                        type: 'varchar',
                        length: '80',
                        isNullable: true,
                    },
                    { name: 'senderAddress', type: 'varchar', length: '64', isNullable: true },
                    {
                        name: 'receivedUsdtAmount',
                        type: 'decimal',
                        precision: 24,
                        scale: 6,
                        isNullable: true,
                    },
                    { name: 'blockNumber', type: 'int', isNullable: true },
                    {
                        name: 'blockTimestamp',
                        type: timestampType,
                        ...timestampPrecision,
                        isNullable: true,
                    },
                    {
                        name: 'lastCheckedAt',
                        type: timestampType,
                        ...timestampPrecision,
                        isNullable: true,
                    },
                    {
                        name: 'settledAt',
                        type: timestampType,
                        ...timestampPrecision,
                        isNullable: true,
                    },
                    { name: 'failureReason', type: 'varchar', length: '500', isNullable: true },
                    {
                        name: 'expiresAt',
                        type: timestampType,
                        ...timestampPrecision,
                        isNullable: false,
                    },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_usdt_intent_quote',
                        columnNames: ['quoteId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_storefront_usdt_intent_match_key',
                        columnNames: ['matchKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_storefront_usdt_intent_transaction',
                        columnNames: ['transactionId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_storefront_usdt_intent_status_expiry',
                        columnNames: ['status', 'expiresAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_storefront_usdt_intent_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_storefront_usdt_intent_order',
                        columnNames: ['orderId'],
                        referencedTableName: 'order',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_storefront_usdt_intent_quote',
                        columnNames: ['quoteId'],
                        referencedTableName: 'storefront_usdt_checkout_quote',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_storefront_usdt_intent_payment',
                        columnNames: ['paymentId'],
                        referencedTableName: 'payment',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_usdt_payment_intent')) {
            await queryRunner.dropTable('storefront_usdt_payment_intent');
        }
    }
}
