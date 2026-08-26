import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddReferralRebate1787774400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = [
            'sqlite',
            'better-sqlite3',
            'sqljs',
            'expo',
            'react-native',
            'cordova',
            'capacitor',
        ].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanTrue = databaseType === 'postgres' ? true : 1;
        const booleanFalse = databaseType === 'postgres' ? false : 0;
        const id = (): TableColumnOptions => ({
            name: 'id',
            type: idType,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
        });
        const timestamps = (): TableColumnOptions[] => [
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
        ];
        const requiredDate = (name: string): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
        });
        const optionalDate = (name: string): TableColumnOptions => ({
            ...requiredDate(name),
            isNullable: true,
        });
        const fk = (
            name: string,
            columnName: string,
            referencedTableName: string,
            onDelete: 'CASCADE' | 'SET NULL' = 'CASCADE',
        ) => ({
            name,
            columnNames: [columnName],
            referencedTableName,
            referencedColumnNames: ['id'],
            onDelete,
        });

        if (!(await queryRunner.hasTable('referral_program_config'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_program_config',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'enabled', type: booleanType, default: booleanFalse },
                        { name: 'rewardRateBps', type: 'int', default: 500 },
                        { name: 'releaseDelayDays', type: 'int', default: 7 },
                        { name: 'minimumOrderAmount', type: 'int', default: 0 },
                        { name: 'maxRewardPerOrder', type: 'int', isNullable: true },
                        { name: 'allowBalanceSpend', type: booleanType, default: booleanTrue },
                        { name: 'attributionWindowDays', type: 'int', default: 30 },
                        {
                            name: 'defaultPosterTemplate',
                            type: 'varchar',
                            length: '32',
                            default: "'BRAND_MINIMAL'",
                        },
                    ],
                    indices: [
                        {
                            name: 'IDX_referral_program_config_channel',
                            columnNames: ['channelId'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [fk('FK_referral_program_config_channel', 'channelId', 'channel')],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('referral_account'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_account',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'inviteCode', type: 'varchar', length: '12' },
                    ],
                    indices: [
                        {
                            name: 'IDX_referral_account_channel_customer',
                            columnNames: ['channelId', 'customerId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_referral_account_channel_code',
                            columnNames: ['channelId', 'inviteCode'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        fk('FK_referral_account_channel', 'channelId', 'channel'),
                        fk('FK_referral_account_customer', 'customerId', 'customer'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('referral_wallet'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_wallet',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'referralAccountId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'availableBalance', type: 'int', default: 0 },
                        { name: 'pendingBalance', type: 'int', default: 0 },
                        { name: 'reservedBalance', type: 'int', default: 0 },
                        { name: 'version', type: 'int' },
                    ],
                    indices: [
                        {
                            name: 'IDX_referral_wallet_account_currency',
                            columnNames: ['referralAccountId', 'currencyCode'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_referral_wallet_channel_customer',
                            columnNames: ['channelId', 'customerId'],
                        },
                    ],
                    foreignKeys: [
                        fk('FK_referral_wallet_channel', 'channelId', 'channel'),
                        fk('FK_referral_wallet_account', 'referralAccountId', 'referral_account'),
                        fk('FK_referral_wallet_customer', 'customerId', 'customer'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('referral_relationship'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_relationship',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'inviterCustomerId', type: idType },
                        { name: 'inviteeCustomerId', type: idType },
                        { name: 'inviteCodeSnapshot', type: 'varchar', length: '12' },
                        { name: 'source', type: 'varchar', length: '16', default: "'CODE'" },
                        requiredDate('boundAt'),
                        optionalDate('firstPaidOrderAt'),
                    ],
                    indices: [
                        {
                            name: 'IDX_referral_relationship_channel_invitee',
                            columnNames: ['channelId', 'inviteeCustomerId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_referral_relationship_channel_inviter_bound',
                            columnNames: ['channelId', 'inviterCustomerId', 'boundAt'],
                        },
                    ],
                    foreignKeys: [
                        fk('FK_referral_relationship_channel', 'channelId', 'channel'),
                        fk('FK_referral_relationship_inviter', 'inviterCustomerId', 'customer'),
                        fk('FK_referral_relationship_invitee', 'inviteeCustomerId', 'customer'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('referral_reward'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_reward',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'inviterCustomerId', type: idType },
                        { name: 'inviteeCustomerId', type: idType },
                        { name: 'orderId', type: idType },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'rewardRateBps', type: 'int' },
                        { name: 'eligibleAmount', type: 'int' },
                        { name: 'rewardAmount', type: 'int' },
                        { name: 'releasedAmount', type: 'int', default: 0 },
                        { name: 'clawedBackAmount', type: 'int', default: 0 },
                        { name: 'settledRefundTotal', type: 'int', default: 0 },
                        { name: 'settledEligibleRefundTotal', type: 'int', default: 0 },
                        { name: 'orderTotalWithTax', type: 'int' },
                        { name: 'status', type: 'varchar', length: '24', default: "'PENDING'" },
                        requiredDate('earnedAt'),
                        requiredDate('availableAt'),
                        optionalDate('releasedAt'),
                    ],
                    indices: [
                        {
                            name: 'IDX_referral_reward_channel_order',
                            columnNames: ['channelId', 'orderId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_referral_reward_inviter_available',
                            columnNames: ['inviterCustomerId', 'availableAt'],
                        },
                    ],
                    foreignKeys: [
                        fk('FK_referral_reward_channel', 'channelId', 'channel'),
                        fk('FK_referral_reward_inviter', 'inviterCustomerId', 'customer'),
                        fk('FK_referral_reward_invitee', 'inviteeCustomerId', 'customer'),
                        fk('FK_referral_reward_order', 'orderId', 'order'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('referral_ledger_entry'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_ledger_entry',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'walletId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'eventType', type: 'varchar', length: '32' },
                        { name: 'availableDelta', type: 'int', default: 0 },
                        { name: 'pendingDelta', type: 'int', default: 0 },
                        { name: 'reservedDelta', type: 'int', default: 0 },
                        { name: 'availableAfter', type: 'int' },
                        { name: 'pendingAfter', type: 'int' },
                        { name: 'reservedAfter', type: 'int' },
                        { name: 'idempotencyKey', type: 'varchar', length: '255' },
                        { name: 'orderId', type: idType, isNullable: true },
                        { name: 'refundId', type: idType, isNullable: true },
                        { name: 'withdrawalId', type: idType, isNullable: true },
                        { name: 'actorId', type: idType, isNullable: true },
                        { name: 'actorType', type: 'varchar', length: '16', default: "'SYSTEM'" },
                        { name: 'note', type: 'varchar', length: '500', isNullable: true },
                        { name: 'metadata', type: 'text', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_referral_ledger_idempotency',
                            columnNames: ['idempotencyKey'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_referral_ledger_channel_created',
                            columnNames: ['channelId', 'createdAt'],
                        },
                        {
                            name: 'IDX_referral_ledger_customer_created',
                            columnNames: ['customerId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        fk('FK_referral_ledger_channel', 'channelId', 'channel'),
                        fk('FK_referral_ledger_wallet', 'walletId', 'referral_wallet'),
                        fk('FK_referral_ledger_customer', 'customerId', 'customer'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('referral_balance_use'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_balance_use',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'walletId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'orderId', type: idType },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'amount', type: 'int' },
                        { name: 'refundedAmount', type: 'int', default: 0 },
                        { name: 'status', type: 'varchar', length: '24', default: "'RESERVED'" },
                        requiredDate('reservedAt'),
                        optionalDate('capturedAt'),
                        optionalDate('releasedAt'),
                    ],
                    indices: [
                        {
                            name: 'IDX_referral_balance_use_channel_order',
                            columnNames: ['channelId', 'orderId'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        fk('FK_referral_balance_use_channel', 'channelId', 'channel'),
                        fk('FK_referral_balance_use_wallet', 'walletId', 'referral_wallet'),
                        fk('FK_referral_balance_use_customer', 'customerId', 'customer'),
                        fk('FK_referral_balance_use_order', 'orderId', 'order'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('referral_withdrawal'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'referral_withdrawal',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'walletId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'code', type: 'varchar', length: '32' },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'amount', type: 'int' },
                        { name: 'status', type: 'varchar', length: '24', default: "'PENDING'" },
                        { name: 'payoutMethod', type: 'varchar', length: '32' },
                        { name: 'payoutAccountMasked', type: 'varchar', length: '160' },
                        { name: 'externalReference', type: 'varchar', length: '160', isNullable: true },
                        { name: 'note', type: 'varchar', length: '500', isNullable: true },
                        { name: 'requestedByAdministratorId', type: idType, isNullable: true },
                        { name: 'processedByAdministratorId', type: idType, isNullable: true },
                        optionalDate('approvedAt'),
                        optionalDate('paidAt'),
                        optionalDate('rejectedAt'),
                        optionalDate('cancelledAt'),
                    ],
                    indices: [
                        { name: 'IDX_referral_withdrawal_code', columnNames: ['code'], isUnique: true },
                        {
                            name: 'IDX_referral_withdrawal_channel_status_created',
                            columnNames: ['channelId', 'status', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        fk('FK_referral_withdrawal_channel', 'channelId', 'channel'),
                        fk('FK_referral_withdrawal_wallet', 'walletId', 'referral_wallet'),
                        fk('FK_referral_withdrawal_customer', 'customerId', 'customer'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('storefront_daily_visitor'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_daily_visitor',
                    columns: [
                        id(),
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'customerId', type: idType, isNullable: true },
                        { name: 'businessDate', type: 'varchar', length: '10' },
                        { name: 'visitorKeyHash', type: 'varchar', length: '64' },
                        requiredDate('firstSeenAt'),
                        requiredDate('lastSeenAt'),
                        { name: 'visitCount', type: 'int', default: 1 },
                    ],
                    indices: [
                        {
                            name: 'IDX_storefront_daily_visitor_identity',
                            columnNames: ['channelId', 'businessDate', 'visitorKeyHash'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_storefront_daily_visitor_channel_date',
                            columnNames: ['channelId', 'businessDate'],
                        },
                    ],
                    foreignKeys: [
                        fk('FK_storefront_daily_visitor_channel', 'channelId', 'channel'),
                        fk('FK_storefront_daily_visitor_customer', 'customerId', 'customer', 'SET NULL'),
                    ],
                }),
                true,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of [
            'storefront_daily_visitor',
            'referral_withdrawal',
            'referral_balance_use',
            'referral_ledger_entry',
            'referral_reward',
            'referral_relationship',
            'referral_wallet',
            'referral_account',
            'referral_program_config',
        ]) {
            if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName, true);
        }
    }
}
