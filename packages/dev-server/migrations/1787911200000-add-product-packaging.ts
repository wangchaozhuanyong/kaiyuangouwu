import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddProductPackaging1787911200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });

        if (!(await queryRunner.hasTable('product_packaging_rule'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'product_packaging_rule',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'enabled', type: 'boolean', default: true },
                        { name: 'autoUnpack', type: 'boolean', default: true },
                        { name: 'unitLabel', type: 'varchar', length: '32' },
                        { name: 'packageLabel', type: 'varchar', length: '32' },
                        { name: 'unitsPerPackage', type: 'int' },
                        { name: 'channelId', type: idType },
                        { name: 'productId', type: idType },
                        { name: 'unitVariantId', type: idType },
                        { name: 'packageVariantId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_product_packaging_rule_channel_product',
                            columnNames: ['channelId', 'productId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_product_packaging_rule_channel_unit_variant',
                            columnNames: ['channelId', 'unitVariantId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_product_packaging_rule_channel_package_variant',
                            columnNames: ['channelId', 'packageVariantId'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_product_packaging_rule_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_product_packaging_rule_product',
                            columnNames: ['productId'],
                            referencedTableName: 'product',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_product_packaging_rule_unit_variant',
                            columnNames: ['unitVariantId'],
                            referencedTableName: 'product_variant',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_product_packaging_rule_package_variant',
                            columnNames: ['packageVariantId'],
                            referencedTableName: 'product_variant',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('packaging_unpack_event'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'packaging_unpack_event',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'reason', type: 'varchar', length: '24' },
                        { name: 'packagesOpened', type: 'int' },
                        { name: 'unitsCreated', type: 'int' },
                        { name: 'packageStockBefore', type: 'int' },
                        { name: 'packageStockAfter', type: 'int' },
                        { name: 'unitStockBefore', type: 'int' },
                        { name: 'unitStockAfter', type: 'int' },
                        { name: 'ruleId', type: idType },
                        { name: 'channelId', type: idType },
                        { name: 'stockLocationId', type: idType },
                        { name: 'orderId', type: idType, isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_packaging_unpack_event_rule_created',
                            columnNames: ['ruleId', 'createdAt'],
                        },
                        { name: 'IDX_packaging_unpack_event_order', columnNames: ['orderId'] },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_packaging_unpack_event_rule',
                            columnNames: ['ruleId'],
                            referencedTableName: 'product_packaging_rule',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_packaging_unpack_event_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_packaging_unpack_event_stock_location',
                            columnNames: ['stockLocationId'],
                            referencedTableName: 'stock_location',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_packaging_unpack_event_order',
                            columnNames: ['orderId'],
                            referencedTableName: 'order',
                            referencedColumnNames: ['id'],
                            onDelete: 'SET NULL',
                        },
                    ],
                }),
                true,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of ['packaging_unpack_event', 'product_packaging_rule']) {
            if (await queryRunner.hasTable(tableName)) {
                await queryRunner.dropTable(tableName, true);
            }
        }
    }
}
