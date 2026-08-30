import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddChannelUsdtWallets1787803200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('store_usdt_wallet')) return;

        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const timestampType = databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const timestampPrecision = isMysql ? { precision: 6 } : {};

        await queryRunner.createTable(
            new Table({
                name: 'store_usdt_wallet',
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
                    {
                        name: 'reviewStatus',
                        type: 'varchar',
                        length: '16',
                        isNullable: false,
                        default: "'UNCONFIGURED'",
                    },
                    { name: 'activeReceivingAddressEncrypted', type: 'text', isNullable: true },
                    {
                        name: 'activeReceivingAddressFingerprint',
                        type: 'varchar',
                        length: '64',
                        isNullable: true,
                    },
                    { name: 'pendingReceivingAddressEncrypted', type: 'text', isNullable: true },
                    {
                        name: 'pendingReceivingAddressFingerprint',
                        type: 'varchar',
                        length: '64',
                        isNullable: true,
                    },
                    { name: 'submittedAt', type: timestampType, ...timestampPrecision, isNullable: true },
                    { name: 'submittedByUserId', type: idType, isNullable: true },
                    { name: 'reviewedAt', type: timestampType, ...timestampPrecision, isNullable: true },
                    { name: 'reviewedByUserId', type: idType, isNullable: true },
                    { name: 'rejectionReason', type: 'varchar', length: '500', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_store_usdt_wallet_channel',
                        columnNames: ['channelId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_store_usdt_wallet_review_status',
                        columnNames: ['reviewStatus'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_store_usdt_wallet_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('store_usdt_wallet')) {
            await queryRunner.dropTable('store_usdt_wallet');
        }
    }
}
