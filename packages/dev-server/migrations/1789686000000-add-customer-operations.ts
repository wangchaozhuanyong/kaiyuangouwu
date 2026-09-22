import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddCustomerOperations1789686000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const databaseType = String(runner.connection.options.type);
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
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
        const foreignKey = (name: string, columnName: string, referencedTableName: string) => ({
            name,
            columnNames: [columnName],
            referencedTableName,
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE' as const,
        });

        await createIfMissing(
            runner,
            new Table({
                name: 'customer_operations_profile',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'segment', type: 'varchar', length: '24' },
                    { name: 'churnRisk', type: 'varchar', length: '16' },
                    { name: 'recencyScore', type: 'int', default: 0 },
                    { name: 'frequencyScore', type: 'int', default: 0 },
                    { name: 'monetaryScore', type: 'int', default: 0 },
                    { name: 'recencyDays', type: 'int', isNullable: true },
                    { name: 'orderCount', type: 'int', default: 0 },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'grossRevenue', type: 'int', default: 0 },
                    { name: 'refundTotal', type: 'int', default: 0 },
                    { name: 'netLifetimeValue', type: 'int', default: 0 },
                    { name: 'averageOrderValue', type: 'int', default: 0 },
                    { name: 'currencyMetricsJson', type: 'text' },
                    { name: 'serviceInteractionCount', type: 'int', default: 0 },
                    { name: 'afterSalesCount', type: 'int', default: 0 },
                    { name: 'openAfterSalesCount', type: 'int', default: 0 },
                    { name: 'lastOrderAt', type: dateType, isNullable: true },
                    { name: 'lastServiceAt', type: dateType, isNullable: true },
                    { name: 'nextFollowUpAt', type: dateType, isNullable: true },
                    { name: 'doNotContact', type: 'boolean', default: false },
                    { name: 'reasonsJson', type: 'text' },
                    { name: 'evaluationVersion', type: 'varchar', length: '32' },
                    { name: 'lastEvaluatedAt', type: dateType },
                ],
                indices: [
                    {
                        name: 'UQ_customer_operations_profile_scope',
                        columnNames: ['channelId', 'customerId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_customer_operations_profile_segment',
                        columnNames: ['channelId', 'segment', 'churnRisk'],
                    },
                    {
                        name: 'IDX_customer_operations_profile_follow_up',
                        columnNames: ['channelId', 'nextFollowUpAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_customer_operations_profile_channel', 'channelId', 'channel'),
                    foreignKey('FK_customer_operations_profile_customer', 'customerId', 'customer'),
                ],
            }),
        );

        await createIfMissing(
            runner,
            new Table({
                name: 'customer_follow_up',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'profileId', type: idType },
                    { name: 'status', type: 'varchar', length: '24' },
                    { name: 'source', type: 'varchar', length: '16' },
                    { name: 'priority', type: 'varchar', length: '8' },
                    { name: 'reasonCode', type: 'varchar', length: '32' },
                    { name: 'title', type: 'varchar', length: '160' },
                    { name: 'note', type: 'text' },
                    { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    { name: 'dueAt', type: dateType },
                    { name: 'ownerUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'outcomeCode', type: 'varchar', length: '32', isNullable: true },
                    { name: 'outcomeNote', type: 'text', isNullable: true },
                    { name: 'completedAt', type: dateType, isNullable: true },
                    { name: 'completedByUserId', type: 'varchar', length: '128', isNullable: true },
                ],
                indices: [
                    {
                        name: 'UQ_customer_follow_up_idempotency',
                        columnNames: ['channelId', 'idempotencyKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_customer_follow_up_queue',
                        columnNames: ['channelId', 'status', 'dueAt', 'priority'],
                    },
                    {
                        name: 'IDX_customer_follow_up_customer',
                        columnNames: ['channelId', 'customerId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_customer_follow_up_channel', 'channelId', 'channel'),
                    foreignKey('FK_customer_follow_up_customer', 'customerId', 'customer'),
                    foreignKey('FK_customer_follow_up_profile', 'profileId', 'customer_operations_profile'),
                ],
            }),
        );

        await createIfMissing(
            runner,
            new Table({
                name: 'customer_follow_up_event',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'followUpId', type: idType },
                    { name: 'eventType', type: 'varchar', length: '24' },
                    { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    { name: 'actorType', type: 'varchar', length: '16' },
                    { name: 'actorLabel', type: 'varchar', length: '160' },
                    { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'note', type: 'text' },
                    { name: 'payloadJson', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'UQ_customer_follow_up_event_key',
                        columnNames: ['followUpId', 'idempotencyKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_customer_follow_up_event_timeline',
                        columnNames: ['followUpId', 'createdAt'],
                    },
                    {
                        name: 'IDX_customer_follow_up_event_customer',
                        columnNames: ['channelId', 'customerId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_customer_follow_up_event_channel', 'channelId', 'channel'),
                    foreignKey('FK_customer_follow_up_event_customer', 'customerId', 'customer'),
                    foreignKey('FK_customer_follow_up_event_follow_up', 'followUpId', 'customer_follow_up'),
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain customer segmentation, follow-up outcomes, and audit evidence'),
        );
    }
}

async function createIfMissing(runner: QueryRunner, table: Table): Promise<void> {
    if (!(await runner.hasTable(table.name))) await runner.createTable(table);
}
