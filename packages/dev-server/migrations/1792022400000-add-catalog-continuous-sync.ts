import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

/** Additive and opt-in only. No existing inventory, ownership or sales data is rewritten. */
export class AddCatalogContinuousSync1792022400000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const driver = runner.connection.options.type;
        const mysql = driver === 'mysql' || driver === 'mariadb';
        const sqlite = ['sqljs', 'sqlite', 'better-sqlite3'].includes(driver);
        const idType = mysql ? 'int' : 'integer';
        const id = (name: string): TableColumnOptions => ({ name, type: idType });
        const integer = (name: string, value = 0): TableColumnOptions => ({
            name,
            type: 'int',
            default: value,
        });
        const text = (name: string, length: string, defaultValue?: string): TableColumnOptions => ({
            name,
            type: 'varchar',
            length,
            ...(defaultValue ? { default: `'${defaultValue}'` } : {}),
        });
        const date = (name: string, nullable = true): TableColumnOptions => ({
            name,
            type: driver === 'postgres' ? 'timestamp without time zone' : 'datetime',
            isNullable: nullable,
            ...(mysql ? { precision: 6 } : {}),
            ...(!nullable
                ? {
                      default: sqlite
                          ? "datetime('now')"
                          : mysql
                            ? 'CURRENT_TIMESTAMP(6)'
                            : 'CURRENT_TIMESTAMP',
                  }
                : {}),
        });
        const boolean = (name: string, value = false): TableColumnOptions => ({
            name,
            type: mysql ? 'tinyint' : 'boolean',
            default: driver === 'postgres' ? value : Number(value),
        });
        const tables = [
            {
                name: 'catalog_sync_rule',
                columns: [
                    id('sourceChannelId'),
                    id('sourceCollectionId'),
                    id('targetChannelId'),
                    id('actorUserId'),
                    boolean('includeDescendants', true),
                    boolean('enabled'),
                    boolean('takeoverConfirmed'),
                    integer('version', 1),
                    text('state', '24', 'DISABLED'),
                    integer('cursor'),
                    integer('generation'),
                    integer('runGeneration'),
                    integer('completedGeneration'),
                    date('lastSyncedAt'),
                    date('leaseUntil'),
                    { ...text('leaseToken', '36'), isNullable: true },
                    { ...text('error', '1000'), isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_sync_rule_identity',
                        columnNames: ['sourceChannelId', 'sourceCollectionId', 'targetChannelId'],
                        isUnique: true,
                    },
                ],
            },
            {
                name: 'catalog_sync_binding',
                columns: [
                    id('ruleId'),
                    id('sourceChannelId'),
                    id('targetChannelId'),
                    text('kind', '16'),
                    id('sourceId'),
                    id('targetId'),
                    text('state', '16', 'PENDING'),
                    { ...text('fingerprint', '64'), isNullable: true },
                    { name: 'baseline', type: 'text', isNullable: true },
                    { ...text('error', '1000'), isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_sync_binding_identity',
                        columnNames: ['ruleId', 'kind', 'sourceId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_catalog_sync_binding_target',
                        columnNames: ['targetChannelId', 'kind', 'targetId'],
                    },
                ],
            },
            {
                name: 'catalog_supply_snapshot',
                columns: [
                    id('orderId'),
                    id('orderLineId'),
                    id('productVariantId'),
                    id('channelId'),
                    id('sourceChannelId'),
                    id('ruleId'),
                    integer('ruleVersion', 1),
                    { name: 'configuration', type: 'text' },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_supply_snapshot_line',
                        columnNames: ['orderLineId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_catalog_supply_snapshot_scope',
                        columnNames: ['channelId', 'productVariantId'],
                    },
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
                            date('createdAt', false),
                            date('updatedAt', false),
                            ...table.columns,
                        ],
                    }),
                    true,
                );
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error(
                'Catalog supply snapshots can be referenced by accepted orders. ' +
                    'Pause synchronization and use a reviewed compatible recovery; do not drop delivery history.',
            ),
        );
    }
}
