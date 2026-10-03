import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

/** Schema only. Historical ownership and channel cleanup require a separately reviewed manifest. */
export class AddPlatformCatalogGovernance1790913600000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const driver = runner.connection.options.type;
        const mysql = driver === 'mysql' || driver === 'mariadb';
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(driver);
        const idType = mysql ? 'int' : 'integer';
        const dateType = driver === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const timestamp = (name: string): TableColumnOptions => ({
            name,
            type: dateType,
            ...(mysql ? { precision: 6 } : {}),
            default: sqlite ? "datetime('now')" : mysql ? 'CURRENT_TIMESTAMP(6)' : 'CURRENT_TIMESTAMP',
        });
        const id = (name: string, nullable = false): TableColumnOptions => ({
            name,
            type: idType,
            isNullable: nullable,
        });
        const text = (name: string, length?: string, defaultValue?: string): TableColumnOptions => ({
            name,
            type: length ? 'varchar' : 'text',
            ...(length ? { length } : {}),
            ...(defaultValue ? { default: `'${defaultValue}'` } : {}),
        });
        const integer = (name: string, defaultValue?: number): TableColumnOptions => ({
            name,
            type: 'int',
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
        });
        const tables = [
            {
                name: 'catalog_resource_ownership',
                columns: [
                    text('resourceType', '32'),
                    id('resourceId'),
                    id('ownerChannelId'),
                    text('scope', '24', 'STORE'),
                ],
                indices: [
                    {
                        name: 'IDX_catalog_resource_identity',
                        columnNames: ['resourceType', 'resourceId'],
                        isUnique: true,
                    },
                    { name: 'IDX_catalog_resource_owner', columnNames: ['ownerChannelId', 'resourceType'] },
                ],
            },
            {
                name: 'product_sales_authorization',
                columns: [
                    id('productId'),
                    id('channelId'),
                    id('sourceChannelId'),
                    text('state', '16', 'PENDING'),
                    text('variantIds'),
                    { ...text('pendingVariantIds'), isNullable: true },
                    integer('version', 1),
                ],
                indices: [
                    {
                        name: 'IDX_product_sales_target',
                        columnNames: ['productId', 'channelId'],
                        isUnique: true,
                    },
                ],
            },
            {
                name: 'catalog_distribution_batch',
                columns: [
                    text('idempotencyKey', '100'),
                    id('actorUserId'),
                    text('inputHash', '64'),
                    text('state', '16', 'PREVIEW'),
                    { ...text('input'), type: mysql ? 'longtext' : 'text' },
                    { ...text('items'), type: mysql ? 'longtext' : 'text' },
                    { ...text('results'), type: mysql ? 'longtext' : 'text' },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_distribution_idempotency',
                        columnNames: ['idempotencyKey'],
                        isUnique: true,
                    },
                ],
            },
            {
                name: 'auto_card_supply_grant',
                columns: [
                    id('channelId'),
                    id('productVariantId'),
                    id('sourceChannelId'),
                    id('configId'),
                    {
                        name: 'enabled',
                        type: mysql ? 'tinyint' : 'boolean',
                        default: driver === 'postgres' ? true : 1,
                    },
                    integer('version', 1),
                ],
                indices: [
                    {
                        name: 'IDX_auto_card_supply_target',
                        columnNames: ['channelId', 'productVariantId'],
                        isUnique: true,
                    },
                ],
            },
            {
                name: 'auto_card_supply_snapshot',
                columns: [
                    id('orderLineId'),
                    id('orderId'),
                    id('channelId'),
                    id('sourceChannelId'),
                    id('configId'),
                    id('grantId', true),
                    { ...integer('grantVersion'), isNullable: true },
                    integer('quantity'),
                    text('configSnapshot'),
                ],
                indices: [
                    { name: 'IDX_auto_card_supply_order_line', columnNames: ['orderLineId'], isUnique: true },
                ],
            },
        ];
        for (const table of tables)
            if (!(await runner.hasTable(table.name)))
                await runner.createTable(
                    new Table({
                        ...table,
                        columns: [
                            {
                                name: 'id',
                                type: idType,
                                isPrimary: true,
                                isGenerated: true,
                                generationStrategy: 'increment',
                            },
                            timestamp('createdAt'),
                            timestamp('updatedAt'),
                            ...table.columns,
                        ],
                    }),
                    true,
                );
        for (const [table, columns] of [
            ['tag', [id('ownerChannelId', true)]],
            [
                'auto_card_delivery',
                [
                    id('sourceChannelId', true),
                    id('supplyGrantId', true),
                    { ...integer('supplyGrantVersion'), isNullable: true },
                ],
            ],
        ] as Array<[string, TableColumnOptions[]]>) {
            if (!(await runner.hasTable(table))) continue;
            for (const column of columns)
                if (!(await runner.hasColumn(table, column.name)))
                    await runner.addColumn(table, new TableColumn(column));
        }
    }

    down(): Promise<void> {
        // These records preserve paid-order delivery provenance. A destructive rollback requires a reviewed data export.
        return Promise.reject(
            new Error('Catalog governance data is retained; use a reviewed forward migration'),
        );
    }
}
