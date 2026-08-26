import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions, TableIndex } from 'typeorm';

const columns: TableColumnOptions[] = [
    {
        name: 'customFieldsUsdtdisplayenabled',
        type: 'boolean',
        isNullable: false,
        default: true,
    },
    {
        name: 'customFieldsUsdtratemarkupbps',
        type: 'int',
        isNullable: false,
        default: 0,
    },
    {
        name: 'customFieldsCnyperusdtrate',
        type: 'float',
        isNullable: true,
    },
    {
        name: 'customFieldsUsdtratesource',
        type: 'varchar',
        length: '120',
        isNullable: true,
    },
    {
        name: 'customFieldsUsdtrateupdatedat',
        type: 'datetime',
        isNullable: true,
    },
];

export class AddStorefrontUsdtDisplay1787778000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        if (!channel) return;
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);

        for (const definition of columns) {
            if (channel.findColumnByName(definition.name)) continue;
            const normalized = { ...definition };
            if (definition.type === 'boolean') {
                normalized.type = isMysql ? 'tinyint' : 'boolean';
                normalized.default = databaseType === 'postgres' ? true : 1;
            }
            if (definition.type === 'float') {
                if (isMysql) normalized.type = 'double';
                if (databaseType === 'postgres' || databaseType === 'cockroachdb') {
                    normalized.type = 'double precision';
                }
            }
            if (
                definition.type === 'datetime' &&
                (databaseType === 'postgres' || databaseType === 'cockroachdb')
            ) {
                normalized.type = 'timestamp';
            }
            if (definition.type === 'datetime' && isMysql) {
                normalized.precision = 6;
            }
            await queryRunner.addColumn('channel', new TableColumn(normalized));
        }

        if (!(await queryRunner.hasTable('storefront_usdt_checkout_quote'))) {
            const timestampType = databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
            const rateType = isMysql
                ? 'double'
                : databaseType === 'postgres' || databaseType === 'cockroachdb'
                  ? 'double precision'
                  : 'float';
            const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
            const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_usdt_checkout_quote',
                    columns: [
                        {
                            name: 'createdAt',
                            type: timestampType,
                            ...(isMysql ? { precision: 6 } : {}),
                            isNullable: false,
                            default: now,
                        },
                        {
                            name: 'updatedAt',
                            type: timestampType,
                            ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                            isNullable: false,
                            default: now,
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
                        { name: 'fiatCurrencyCode', type: 'varchar', length: '3', isNullable: false },
                        { name: 'fiatAmount', type: 'int', isNullable: false },
                        { name: 'fiatPerUsdtRate', type: rateType, isNullable: false },
                        { name: 'markupBps', type: 'int', isNullable: false, default: 0 },
                        {
                            name: 'usdtAmount',
                            type: 'decimal',
                            precision: 24,
                            scale: 6,
                            isNullable: false,
                        },
                        { name: 'source', type: 'varchar', length: '120', isNullable: false },
                        {
                            name: 'expiresAt',
                            type: timestampType,
                            ...(isMysql ? { precision: 6 } : {}),
                            isNullable: false,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_usdt_quote_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_storefront_usdt_quote_order',
                            columnNames: ['orderId'],
                            referencedTableName: 'order',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
            await queryRunner.createIndex(
                'storefront_usdt_checkout_quote',
                new TableIndex({
                    name: 'IDX_storefront_usdt_quote_order_expiry',
                    columnNames: ['orderId', 'expiresAt'],
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_usdt_checkout_quote')) {
            await queryRunner.dropTable('storefront_usdt_checkout_quote');
        }
        const channel = await queryRunner.getTable('channel');
        if (!channel) return;
        for (const definition of [...columns].reverse()) {
            if (channel.findColumnByName(definition.name)) {
                await queryRunner.dropColumn('channel', definition.name);
            }
        }
    }
}
