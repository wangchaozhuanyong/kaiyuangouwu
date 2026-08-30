import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddCatalogSuppliers1787868000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
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

        if (!(await queryRunner.hasTable('catalog_supplier'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'catalog_supplier',
                    columns: [
                        ...baseColumns(),
                        { name: 'channelId', type: idType },
                        { name: 'code', type: 'varchar', length: '64' },
                        { name: 'name', type: 'varchar', length: '255' },
                        { name: 'normalizedName', type: 'varchar', length: '255' },
                        { name: 'enabled', type: 'boolean', default: true },
                        { name: 'contactName', type: 'varchar', length: '120', isNullable: true },
                        { name: 'phone', type: 'varchar', length: '80', isNullable: true },
                        { name: 'email', type: 'varchar', length: '255', isNullable: true },
                        { name: 'address', type: 'varchar', length: '500', isNullable: true },
                        { name: 'notes', type: 'text', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_catalog_supplier_channel_code',
                            columnNames: ['channelId', 'code'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_catalog_supplier_channel_name',
                            columnNames: ['channelId', 'normalizedName'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_catalog_supplier_channel_enabled',
                            columnNames: ['channelId', 'enabled'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_catalog_supplier_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
        }

        if (!(await queryRunner.hasTable('catalog_variant_supplier'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'catalog_variant_supplier',
                    columns: [
                        ...baseColumns(),
                        { name: 'channelId', type: idType },
                        { name: 'variantId', type: idType },
                        { name: 'supplierId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_catalog_variant_supplier_channel_variant',
                            columnNames: ['channelId', 'variantId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_catalog_variant_supplier_supplier',
                            columnNames: ['supplierId'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_catalog_variant_supplier_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_catalog_variant_supplier_variant',
                            columnNames: ['variantId'],
                            referencedTableName: 'product_variant',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_catalog_variant_supplier_supplier',
                            columnNames: ['supplierId'],
                            referencedTableName: 'catalog_supplier',
                            referencedColumnNames: ['id'],
                            onDelete: 'RESTRICT',
                        },
                    ],
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('catalog_variant_supplier')) {
            await queryRunner.dropTable('catalog_variant_supplier', true);
        }
        if (await queryRunner.hasTable('catalog_supplier')) {
            await queryRunner.dropTable('catalog_supplier', true);
        }
    }
}
