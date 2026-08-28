import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

const variantCustomFields = [
    { name: 'customFieldsBarcode', type: 'varchar', length: '255' },
    { name: 'customFieldsSpecification', type: 'varchar', length: '255' },
    { name: 'customFieldsSaleunit', type: 'varchar', length: '255' },
    { name: 'customFieldsPurchaseunit', type: 'varchar', length: '255' },
    { name: 'customFieldsPackagequantity', type: 'float' },
    { name: 'customFieldsShelflifedays', type: 'int' },
] as const;

export class AddCatalogManagement1787824800000 implements MigrationInterface {
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
        const foreignKey = (
            name: string,
            columnName: string,
            referencedTableName: string,
            onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE',
        ) => ({
            name,
            columnNames: [columnName],
            referencedTableName,
            referencedColumnNames: ['id'],
            onDelete,
        });

        const productVariant = await queryRunner.getTable('product_variant');
        if (productVariant) {
            for (const field of variantCustomFields) {
                if (!productVariant.findColumnByName(field.name)) {
                    await queryRunner.addColumn(
                        'product_variant',
                        new TableColumn({ ...field, isNullable: true }),
                    );
                }
            }
        }

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'catalog_import_job',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'stockLocationId', type: idType },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'originalFilename', type: 'varchar', length: '255' },
                    { name: 'mimeType', type: 'varchar', length: '120' },
                    { name: 'byteSize', type: 'int' },
                    { name: 'fileHash', type: 'varchar', length: '64' },
                    { name: 'state', type: 'varchar', length: '24', default: "'PREVIEW_READY'" },
                    { name: 'actorId', type: 'varchar', length: '64', isNullable: true },
                    { name: 'totalRows', type: 'int', default: 0 },
                    { name: 'createdCount', type: 'int', default: 0 },
                    { name: 'updatedCount', type: 'int', default: 0 },
                    { name: 'skippedCount', type: 'int', default: 0 },
                    { name: 'conflictCount', type: 'int', default: 0 },
                    { name: 'warningCount', type: 'int', default: 0 },
                    { name: 'errorCount', type: 'int', default: 0 },
                    { name: 'progress', type: 'int', default: 0 },
                    { name: 'errorMessage', type: 'varchar', length: '500', isNullable: true },
                    { name: 'startedAt', type: dateType, isNullable: true },
                    { name: 'completedAt', type: dateType, isNullable: true },
                    { name: 'rolledBackAt', type: dateType, isNullable: true },
                    { name: 'version', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_import_job_context_hash',
                        columnNames: ['channelId', 'stockLocationId', 'currencyCode', 'fileHash'],
                    },
                    { name: 'IDX_catalog_import_job_state_created', columnNames: ['state', 'createdAt'] },
                ],
                foreignKeys: [
                    foreignKey('FK_catalog_import_job_channel', 'channelId', 'channel'),
                    foreignKey(
                        'FK_catalog_import_job_stock_location',
                        'stockLocationId',
                        'stock_location',
                        'RESTRICT',
                    ),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'catalog_import_row',
                columns: [
                    ...baseColumns(),
                    { name: 'jobId', type: idType },
                    { name: 'rowNumber', type: 'int' },
                    { name: 'productKey', type: 'varchar', length: '64' },
                    { name: 'sourceKey', type: 'varchar', length: '64' },
                    { name: 'rowFingerprint', type: 'varchar', length: '64' },
                    { name: 'action', type: 'varchar', length: '24' },
                    { name: 'resolution', type: 'varchar', length: '24', isNullable: true },
                    { name: 'targetProductId', type: idType, isNullable: true },
                    { name: 'targetVariantId', type: idType, isNullable: true },
                    { name: 'expectedProductUpdatedAt', type: dateType, isNullable: true },
                    { name: 'expectedVariantUpdatedAt', type: dateType, isNullable: true },
                    { name: 'normalizedData', type: 'text' },
                    { name: 'beforeSnapshot', type: 'text', isNullable: true },
                    { name: 'plannedChanges', type: 'text', isNullable: true },
                    { name: 'appliedSnapshot', type: 'text', isNullable: true },
                    { name: 'message', type: 'varchar', length: '500', isNullable: true },
                    { name: 'appliedAt', type: dateType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_import_row_job_number',
                        columnNames: ['jobId', 'rowNumber'],
                        isUnique: true,
                    },
                    { name: 'IDX_catalog_import_row_job_action', columnNames: ['jobId', 'action'] },
                ],
                foreignKeys: [foreignKey('FK_catalog_import_row_job', 'jobId', 'catalog_import_job')],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'catalog_source_binding',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'sourceKey', type: 'varchar', length: '64' },
                    { name: 'productId', type: idType },
                    { name: 'variantId', type: idType },
                    { name: 'lastFingerprint', type: 'varchar', length: '64' },
                    { name: 'lastFileHash', type: 'varchar', length: '64' },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_source_binding_channel_key',
                        columnNames: ['channelId', 'sourceKey'],
                        isUnique: true,
                    },
                    { name: 'IDX_catalog_source_binding_variant', columnNames: ['variantId'] },
                ],
                foreignKeys: [
                    foreignKey('FK_catalog_source_binding_channel', 'channelId', 'channel'),
                    foreignKey('FK_catalog_source_binding_product', 'productId', 'product'),
                    foreignKey('FK_catalog_source_binding_variant', 'variantId', 'product_variant'),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'catalog_variant_cost_record',
                columns: [
                    ...baseColumns(),
                    { name: 'variantId', type: idType },
                    { name: 'channelId', type: idType },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'costMicrounits', type: 'bigint' },
                    { name: 'effectiveAt', type: dateType },
                    { name: 'source', type: 'varchar', length: '24' },
                    { name: 'sourceReference', type: 'varchar', length: '64', isNullable: true },
                    { name: 'actorId', type: 'varchar', length: '64', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_variant_cost_current',
                        columnNames: ['variantId', 'channelId', 'currencyCode', 'effectiveAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_catalog_variant_cost_variant', 'variantId', 'product_variant'),
                    foreignKey('FK_catalog_variant_cost_channel', 'channelId', 'channel'),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'catalog_inventory_policy',
                columns: [
                    ...baseColumns(),
                    { name: 'variantId', type: idType },
                    { name: 'stockLocationId', type: idType },
                    { name: 'minimumStock', type: 'int', isNullable: true },
                    { name: 'maximumStock', type: 'int', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_inventory_policy_variant_location',
                        columnNames: ['variantId', 'stockLocationId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_catalog_inventory_policy_variant', 'variantId', 'product_variant'),
                    foreignKey('FK_catalog_inventory_policy_location', 'stockLocationId', 'stock_location'),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'catalog_inventory_lot',
                columns: [
                    ...baseColumns(),
                    { name: 'variantId', type: idType },
                    { name: 'stockLocationId', type: idType },
                    { name: 'lotCode', type: 'varchar', length: '80' },
                    { name: 'manufacturedAt', type: dateType, isNullable: true },
                    { name: 'expiresAt', type: dateType, isNullable: true },
                    { name: 'quantityOnHand', type: 'int', default: 0 },
                    { name: 'purchaseCostMicrounits', type: 'bigint', isNullable: true },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'state', type: 'varchar', length: '24', default: "'ACTIVE'" },
                    { name: 'version', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_inventory_lot_unique',
                        columnNames: ['variantId', 'stockLocationId', 'lotCode'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_catalog_inventory_lot_expiry',
                        columnNames: ['stockLocationId', 'expiresAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_catalog_inventory_lot_variant', 'variantId', 'product_variant'),
                    foreignKey('FK_catalog_inventory_lot_location', 'stockLocationId', 'stock_location'),
                ],
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of [
            'catalog_inventory_lot',
            'catalog_inventory_policy',
            'catalog_variant_cost_record',
            'catalog_source_binding',
            'catalog_import_row',
            'catalog_import_job',
        ]) {
            if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table, true);
        }
        const productVariant = await queryRunner.getTable('product_variant');
        if (productVariant) {
            for (const field of [...variantCustomFields].reverse()) {
                if (productVariant.findColumnByName(field.name)) {
                    await queryRunner.dropColumn('product_variant', field.name);
                }
            }
        }
    }
}

async function createIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
    if (!(await queryRunner.hasTable(table.name))) await queryRunner.createTable(table);
}
