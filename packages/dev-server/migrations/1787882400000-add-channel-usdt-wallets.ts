import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class AddChannelUsdtWallets1787882400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const channelTable = await queryRunner.getTable('channel');
        const userTable = await queryRunner.getTable('user');
        const channelId = channelTable?.findColumnByName('id');
        const userId = userTable?.findColumnByName('id');
        if (!channelId || !userId) {
            throw new Error('channel.id and user.id must exist before Channel USDT wallets');
        }

        const databaseType = queryRunner.connection.options.type;
        const timestamps = timestampColumns(databaseType);

        if (!(await queryRunner.hasTable('store_usdt_wallet'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'store_usdt_wallet',
                    columns: [
                        ...timestamps,
                        generatedIdColumn(channelId),
                        relationIdColumn('channelId', channelId),
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
                        nullableRelationIdColumn('submittedByUserId', userId),
                        nullableTimestampColumn('submittedAt', databaseType),
                        nullableRelationIdColumn('reviewedByUserId', userId),
                        nullableTimestampColumn('reviewedAt', databaseType),
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

        if (!(await queryRunner.hasTable('store_usdt_wallet_audit'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'store_usdt_wallet_audit',
                    columns: [
                        ...timestampColumns(databaseType),
                        generatedIdColumn(channelId),
                        relationIdColumn('channelId', channelId),
                        { name: 'action', type: 'varchar', length: '16', isNullable: false },
                        {
                            name: 'addressFingerprint',
                            type: 'varchar',
                            length: '64',
                            isNullable: false,
                        },
                        nullableRelationIdColumn('actorUserId', userId),
                        { name: 'note', type: 'varchar', length: '500', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_store_usdt_wallet_audit_channel_created',
                            columnNames: ['channelId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_store_usdt_wallet_audit_channel',
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
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('store_usdt_wallet_audit')) {
            await queryRunner.dropTable('store_usdt_wallet_audit');
        }
        if (await queryRunner.hasTable('store_usdt_wallet')) {
            await queryRunner.dropTable('store_usdt_wallet');
        }
    }
}

function timestampColumns(databaseType: string) {
    const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
    const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
    const type = databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
    const defaultValue = isMysql
        ? 'CURRENT_TIMESTAMP(6)'
        : isSqlite
          ? "datetime('now')"
          : 'CURRENT_TIMESTAMP';
    return [
        {
            name: 'createdAt',
            type,
            ...(isMysql ? { precision: 6 } : {}),
            isNullable: false,
            default: defaultValue,
        },
        {
            name: 'updatedAt',
            type,
            ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
            isNullable: false,
            default: defaultValue,
        },
    ];
}

function nullableTimestampColumn(name: string, databaseType: string) {
    const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
    return {
        name,
        type: databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime',
        ...(isMysql ? { precision: 6 } : {}),
        isNullable: true,
    };
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

function nullableRelationIdColumn(name: string, referenced: TableColumn) {
    return { ...idColumnType(referenced), name, isNullable: true };
}

function idColumnType(referenced: TableColumn) {
    return {
        type: referenced.type,
        ...(referenced.length ? { length: referenced.length } : {}),
        ...(referenced.width ? { width: referenced.width } : {}),
        ...(referenced.unsigned ? { unsigned: true } : {}),
    };
}
