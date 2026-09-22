import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

export class AddMarketingAttribution1789689600000 implements MigrationInterface {
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

        if (await runner.hasTable('storefront_page_view')) {
            const additions: TableColumnOptions[] = [
                { name: 'attributionKeyHash', type: 'varchar', length: '64', isNullable: true },
                { name: 'path', type: 'varchar', length: '512', isNullable: true },
                { name: 'referrerHost', type: 'varchar', length: '255', isNullable: true },
                { name: 'source', type: 'varchar', length: '100', isNullable: true },
                { name: 'medium', type: 'varchar', length: '100', isNullable: true },
                { name: 'campaign', type: 'varchar', length: '160', isNullable: true },
                { name: 'term', type: 'varchar', length: '160', isNullable: true },
                { name: 'content', type: 'varchar', length: '160', isNullable: true },
            ];
            for (const column of additions) {
                if (!(await runner.hasColumn('storefront_page_view', column.name))) {
                    await runner.addColumn('storefront_page_view', new TableColumn(column));
                }
            }
        }

        if (!(await runner.hasTable('storefront_order_attribution'))) {
            await runner.createTable(
                new Table({
                    name: 'storefront_order_attribution',
                    columns: [
                        ...baseColumns(),
                        { name: 'channelId', type: idType },
                        { name: 'orderId', type: idType },
                        { name: 'touchEventId', type: 'varchar', length: '36', isNullable: true },
                        { name: 'attributionModel', type: 'varchar', length: '32' },
                        { name: 'source', type: 'varchar', length: '100' },
                        { name: 'medium', type: 'varchar', length: '100' },
                        { name: 'campaign', type: 'varchar', length: '160' },
                        { name: 'term', type: 'varchar', length: '160' },
                        { name: 'content', type: 'varchar', length: '160' },
                        { name: 'landingPath', type: 'varchar', length: '512', isNullable: true },
                        { name: 'referrerHost', type: 'varchar', length: '255', isNullable: true },
                        { name: 'touchAt', type: dateType },
                    ],
                    indices: [
                        {
                            name: 'UQ_storefront_order_attribution_order',
                            columnNames: ['orderId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_storefront_order_attribution_report',
                            columnNames: ['channelId', 'source', 'campaign', 'touchAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_order_attribution_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_storefront_order_attribution_order',
                            columnNames: ['orderId'],
                            referencedTableName: 'order',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
        }

        if (!(await runner.hasTable('marketing_campaign_cost'))) {
            await runner.createTable(
                new Table({
                    name: 'marketing_campaign_cost',
                    columns: [
                        ...baseColumns(),
                        { name: 'channelId', type: idType },
                        { name: 'businessDate', type: 'varchar', length: '10' },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'source', type: 'varchar', length: '100' },
                        { name: 'medium', type: 'varchar', length: '100' },
                        { name: 'campaign', type: 'varchar', length: '160' },
                        { name: 'amountMicrounits', type: 'bigint' },
                        { name: 'idempotencyKey', type: 'varchar', length: '96' },
                        { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'reason', type: 'varchar', length: '500' },
                    ],
                    indices: [
                        {
                            name: 'UQ_marketing_campaign_cost_key',
                            columnNames: ['channelId', 'idempotencyKey'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_marketing_campaign_cost_report',
                            columnNames: ['channelId', 'businessDate', 'currencyCode'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_marketing_campaign_cost_channel',
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
            new Error('Retain frozen order attribution and append-only campaign cost evidence'),
        );
    }
}
