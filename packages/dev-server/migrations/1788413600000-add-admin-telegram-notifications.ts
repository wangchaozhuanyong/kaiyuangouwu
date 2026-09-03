import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddAdminTelegramNotifications1788413600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanTrue = databaseType === 'postgres' ? true : 1;
        const booleanFalse = databaseType === 'postgres' ? false : 0;
        const baseColumns = (): TableColumnOptions[] => [
            { name: 'createdAt', type: dateType, ...(isMysql ? { precision: 6 } : {}), default: now },
            {
                name: 'updatedAt',
                type: dateType,
                ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                default: now,
            },
            { name: 'id', type: idType, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        ];

        if (!(await queryRunner.hasTable('admin_notification_config'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'admin_notification_config',
                    columns: [
                        ...baseColumns(),
                        { name: 'key', type: 'varchar', length: '48', default: "'telegram-internal'" },
                        { name: 'enabled', type: booleanType, default: booleanFalse },
                        { name: 'chatId', type: 'varchar', length: '64', isNullable: true },
                        { name: 'adminBaseUrl', type: 'varchar', length: '500', isNullable: true },
                        { name: 'timezone', type: 'varchar', length: '64', default: "'Asia/Kuala_Lumpur'" },
                        { name: 'minSeverity', type: 'varchar', length: '2', default: "'P3'" },
                        { name: 'sendResolved', type: booleanType, default: booleanTrue },
                        { name: 'p2Silent', type: booleanType, default: booleanTrue },
                        { name: 'p3Silent', type: booleanType, default: booleanTrue },
                        { name: 'notifyOrderEvents', type: booleanType, default: booleanTrue },
                        { name: 'notifyPaymentEvents', type: booleanType, default: booleanTrue },
                        { name: 'notifyFulfillmentEvents', type: booleanType, default: booleanTrue },
                        { name: 'notifyRefundEvents', type: booleanType, default: booleanTrue },
                        { name: 'notifyInventoryEvents', type: booleanType, default: booleanTrue },
                        { name: 'inventoryLowThreshold', type: 'int', default: 2 },
                        { name: 'p1EscalationMinutes', type: 'int', default: 60 },
                        { name: 'p0RepeatMinutes', type: 'int', default: 30 },
                        { name: 'p1RepeatMinutes', type: 'int', default: 120 },
                        { name: 'departmentMentions', type: 'text', isNullable: true },
                        { name: 'routeOverrides', type: 'text', isNullable: true },
                        { name: 'botUsername', type: 'varchar', length: '120', isNullable: true },
                        { name: 'lastConnectionAt', type: dateType, isNullable: true },
                        { name: 'lastConnectionError', type: 'varchar', length: '500', isNullable: true },
                    ],
                    indices: [
                        { name: 'IDX_admin_notification_config_key', columnNames: ['key'], isUnique: true },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('admin_notification_outbox'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'admin_notification_outbox',
                    columns: [
                        ...baseColumns(),
                        { name: 'eventType', type: 'varchar', length: '100' },
                        { name: 'category', type: 'varchar', length: '32' },
                        { name: 'ownerDepartmentCode', type: 'varchar', length: '32' },
                        { name: 'collaboratorDepartmentCodes', type: 'text' },
                        { name: 'escalationDepartmentCode', type: 'varchar', length: '32', isNullable: true },
                        { name: 'actionRequired', type: booleanType, default: booleanFalse },
                        { name: 'slaDueAt', type: dateType, isNullable: true },
                        { name: 'actionHint', type: 'varchar', length: '500' },
                        { name: 'severity', type: 'varchar', length: '2' },
                        { name: 'mode', type: 'varchar', length: '16' },
                        { name: 'eventState', type: 'varchar', length: '16' },
                        { name: 'sourceType', type: 'varchar', length: '64', isNullable: true },
                        { name: 'sourceId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'dedupKey', type: 'varchar', length: '255', isNullable: true },
                        { name: 'fingerprint', type: 'varchar', length: '255', isNullable: true },
                        { name: 'activeFingerprint', type: 'varchar', length: '255', isNullable: true },
                        { name: 'title', type: 'varchar', length: '300' },
                        { name: 'payload', type: 'text' },
                        { name: 'occurrenceCount', type: 'int', default: 1 },
                        { name: 'firstOccurredAt', type: dateType },
                        { name: 'lastOccurredAt', type: dateType },
                        { name: 'resolvedAt', type: dateType, isNullable: true },
                        { name: 'escalatedAt', type: dateType, isNullable: true },
                        { name: 'priority', type: 'int', default: 50 },
                        { name: 'silent', type: booleanType, default: booleanFalse },
                        { name: 'deliveryAction', type: 'varchar', length: '16', default: "'SEND'" },
                        { name: 'deliveryStatus', type: 'varchar', length: '16', default: "'PENDING'" },
                        { name: 'availableAt', type: dateType },
                        { name: 'attempts', type: 'int', default: 0 },
                        { name: 'maxAttempts', type: 'int', default: 6 },
                        { name: 'claimedAt', type: dateType, isNullable: true },
                        { name: 'claimedBy', type: 'varchar', length: '160', isNullable: true },
                        { name: 'telegramMessageId', type: 'varchar', length: '64', isNullable: true },
                        { name: 'queueJobId', type: 'varchar', length: '120', isNullable: true },
                        { name: 'lastErrorCode', type: 'varchar', length: '64', isNullable: true },
                        { name: 'lastError', type: 'varchar', length: '1024', isNullable: true },
                        { name: 'sentAt', type: dateType, isNullable: true },
                    ],
                    indices: [
                        { name: 'IDX_admin_notification_dedup', columnNames: ['dedupKey'], isUnique: true },
                        {
                            name: 'IDX_admin_notification_active_fingerprint',
                            columnNames: ['activeFingerprint'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_admin_notification_delivery_claim',
                            columnNames: ['deliveryStatus', 'availableAt', 'priority'],
                        },
                        { name: 'IDX_admin_notification_claimed_at', columnNames: ['claimedAt'] },
                        { name: 'IDX_admin_notification_source', columnNames: ['sourceType', 'sourceId'] },
                        {
                            name: 'IDX_admin_notification_owner_status_created',
                            columnNames: ['ownerDepartmentCode', 'deliveryStatus', 'createdAt'],
                        },
                        { name: 'IDX_admin_notification_sla', columnNames: ['actionRequired', 'slaDueAt'] },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('admin_notification_config_audit'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'admin_notification_config_audit',
                    columns: [
                        ...baseColumns(),
                        { name: 'action', type: 'varchar', length: '32', default: "'UPDATED'" },
                        { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'changes', type: 'text' },
                    ],
                    indices: [
                        {
                            name: 'IDX_admin_notification_config_audit_created',
                            columnNames: ['createdAt'],
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('admin_notification_runtime'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'admin_notification_runtime',
                    columns: [
                        ...baseColumns(),
                        { name: 'key', type: 'varchar', length: '48', default: "'telegram-worker'" },
                        { name: 'state', type: 'varchar', length: '16', default: "'STOPPED'" },
                        { name: 'workerId', type: 'varchar', length: '160', isNullable: true },
                        { name: 'heartbeatAt', type: dateType, isNullable: true },
                        { name: 'lastSuccessAt', type: dateType, isNullable: true },
                        { name: 'lastErrorAt', type: dateType, isNullable: true },
                        { name: 'lastError', type: 'varchar', length: '500', isNullable: true },
                        { name: 'processed', type: 'int', default: 0 },
                        { name: 'failures', type: 'int', default: 0 },
                    ],
                    indices: [
                        { name: 'IDX_admin_notification_runtime_key', columnNames: ['key'], isUnique: true },
                    ],
                }),
                true,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of [
            'admin_notification_runtime',
            'admin_notification_outbox',
            'admin_notification_config_audit',
            'admin_notification_config',
        ]) {
            if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName, true);
        }
    }
}
