import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

/** Additive only: preserves existing bot, routing, deliveries and commerce data. */
export class AddUnifiedStoreNotifications1790899200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const type = runner.connection.options.type;
        const mysql = type === 'mysql' || type === 'mariadb';
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const idType = type === 'postgres' || sqlite ? 'integer' : 'int';
        const boolType = mysql ? 'tinyint' : 'boolean';
        for (const name of [
            'notifyOnlineReports',
            'notifyServiceReviews',
            'notifyPromotionExpiry',
            'notifyAiCredentials',
            'notifySecurityEvents',
        ]) {
            if (!(await runner.hasColumn('admin_notification_config', name))) {
                await runner.addColumn(
                    'admin_notification_config',
                    // Activate only after configuration backup, Bot validation and explicit readback.
                    new TableColumn({ name, type: boolType, default: type === 'postgres' ? false : 0 }),
                );
            }
        }
        if (!(await runner.hasColumn('admin_notification_outbox', 'expiresAt'))) {
            await runner.addColumn(
                'admin_notification_outbox',
                new TableColumn({ name: 'expiresAt', type: dateType, isNullable: true }),
            );
        }
        if (
            (await runner.hasTable('customer_service_feedback')) &&
            !(await runner.hasColumn('customer_service_feedback', 'notificationRevision'))
        ) {
            await runner.addColumn(
                'customer_service_feedback',
                new TableColumn({ name: 'notificationRevision', type: 'int', default: 0 }),
            );
        }
        const base = (): TableColumnOptions[] => [
            { name: 'id', type: idType, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
            {
                name: 'createdAt',
                type: dateType,
                ...(mysql ? { precision: 6 } : {}),
                default: mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP',
            },
            {
                name: 'updatedAt',
                type: dateType,
                ...(mysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                default: mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP',
            },
        ];
        const channel = { name: 'channelId', type: idType };
        const hash = (name: string, nullable = false): TableColumnOptions => ({
            name,
            type: 'varchar',
            length: '64',
            isNullable: nullable,
        });
        const tables = [
            new Table({
                name: 'storefront_presence',
                columns: [
                    ...base(),
                    channel,
                    hash('visitorKeyHash'),
                    hash('customerKeyHash', true),
                    { name: 'lastSeenAt', type: dateType },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_presence_identity',
                        columnNames: ['channelId', 'visitorKeyHash'],
                        isUnique: true,
                    },
                    { name: 'IDX_storefront_presence_active', columnNames: ['channelId', 'lastSeenAt'] },
                ],
            }),
            new Table({
                name: 'storefront_presence_status',
                columns: [...base(), channel, { name: 'firstSeenAt', type: dateType }],
                indices: [
                    {
                        name: 'IDX_storefront_presence_status_channel',
                        columnNames: ['channelId'],
                        isUnique: true,
                    },
                ],
            }),
            new Table({
                name: 'customer_service_review',
                columns: [
                    ...base(),
                    channel,
                    { name: 'customerId', type: idType, isNullable: true },
                    { name: 'orderId', type: idType, isNullable: true },
                    hash('ownerKey'),
                    hash('submissionKey'),
                    { name: 'rating', type: 'int' },
                    { name: 'tags', type: 'text' },
                    { name: 'comment', type: 'text' },
                    hash('orderCode', true),
                    { name: 'revision', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_service_review_identity',
                        columnNames: ['channelId', 'ownerKey', 'submissionKey'],
                        isUnique: true,
                    },
                    { name: 'IDX_service_review_channel_created', columnNames: ['channelId', 'createdAt'] },
                ],
            }),
            new Table({
                name: 'admin_notification_signal',
                columns: [
                    ...base(),
                    hash('key'),
                    hash('identityHash'),
                    { name: 'count', type: 'int', default: 0 },
                    { name: 'expiresAt', type: dateType },
                ],
                indices: [
                    { name: 'IDX_admin_notification_signal_key', columnNames: ['key'], isUnique: true },
                    { name: 'IDX_admin_notification_signal_expiry', columnNames: ['expiresAt'] },
                    {
                        name: 'IDX_admin_notification_signal_identity',
                        columnNames: ['identityHash', 'expiresAt'],
                    },
                ],
            }),
        ];
        for (const table of tables)
            if (!(await runner.hasTable(table.name))) await runner.createTable(table, true);
    }
    async down(runner: QueryRunner): Promise<void> {
        for (const name of [
            'admin_notification_signal',
            'customer_service_review',
            'storefront_presence_status',
            'storefront_presence',
        ]) {
            if (await runner.hasTable(name)) await runner.dropTable(name);
        }
        if (
            (await runner.hasTable('customer_service_feedback')) &&
            (await runner.hasColumn('customer_service_feedback', 'notificationRevision'))
        )
            await runner.dropColumn('customer_service_feedback', 'notificationRevision');
        if (await runner.hasColumn('admin_notification_outbox', 'expiresAt'))
            await runner.dropColumn('admin_notification_outbox', 'expiresAt');
        for (const name of [
            'notifyOnlineReports',
            'notifyServiceReviews',
            'notifyPromotionExpiry',
            'notifyAiCredentials',
            'notifySecurityEvents',
        ]) {
            if (await runner.hasColumn('admin_notification_config', name))
                await runner.dropColumn('admin_notification_config', name);
        }
    }
}
