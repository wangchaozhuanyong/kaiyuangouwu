import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddPurchaseOrderWorkflow1789506000000 implements MigrationInterface {
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
        const foreignKey = (
            name: string,
            columnName: string,
            referencedTableName: string,
            onDelete: 'CASCADE' | 'RESTRICT' = 'RESTRICT',
        ) => ({
            name,
            columnNames: [columnName],
            referencedTableName,
            referencedColumnNames: ['id'],
            onDelete,
        });

        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_purchase_order',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'supplierId', type: idType },
                    { name: 'stockLocationId', type: idType },
                    { name: 'code', type: 'varchar', length: '64' },
                    { name: 'status', type: 'varchar', length: '24', default: "'DRAFT'" },
                    { name: 'paymentStatus', type: 'varchar', length: '24', default: "'UNPAID'" },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'totalMicrounits', type: 'bigint', default: 0 },
                    { name: 'paidMicrounits', type: 'bigint', default: 0 },
                    { name: 'returnCreditMicrounits', type: 'bigint', default: 0 },
                    { name: 'expectedAt', type: dateType, isNullable: true },
                    { name: 'submittedAt', type: dateType, isNullable: true },
                    { name: 'closedAt', type: dateType, isNullable: true },
                    { name: 'createdByUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'submittedByUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'closedByUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'notes', type: 'text', isNullable: true },
                    { name: 'closureNote', type: 'text', isNullable: true },
                    { name: 'version', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_purchase_order_channel_code',
                        columnNames: ['channelId', 'code'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_catalog_purchase_order_channel_status',
                        columnNames: ['channelId', 'status', 'expectedAt'],
                    },
                    {
                        name: 'IDX_catalog_purchase_order_supplier_created',
                        columnNames: ['supplierId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_catalog_purchase_order_channel', 'channelId', 'channel', 'CASCADE'),
                    foreignKey('FK_catalog_purchase_order_supplier', 'supplierId', 'catalog_supplier'),
                    foreignKey('FK_catalog_purchase_order_location', 'stockLocationId', 'stock_location'),
                ],
            }),
        );
        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_purchase_order_line',
                columns: [
                    ...baseColumns(),
                    { name: 'purchaseOrderId', type: idType },
                    { name: 'variantId', type: idType },
                    { name: 'orderedQuantity', type: 'int' },
                    { name: 'receivedQuantity', type: 'int', default: 0 },
                    { name: 'acceptedQuantity', type: 'int', default: 0 },
                    { name: 'rejectedQuantity', type: 'int', default: 0 },
                    { name: 'returnedQuantity', type: 'int', default: 0 },
                    { name: 'unitCostMicrounits', type: 'bigint' },
                    { name: 'purchaseUnit', type: 'varchar', length: '80', isNullable: true },
                    { name: 'packageQuantity', type: 'float', default: 1 },
                    { name: 'notes', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_purchase_order_line_order_variant',
                        columnNames: ['purchaseOrderId', 'variantId'],
                        isUnique: true,
                    },
                    { name: 'IDX_catalog_purchase_order_line_variant', columnNames: ['variantId'] },
                ],
                foreignKeys: [
                    foreignKey(
                        'FK_catalog_purchase_line_order',
                        'purchaseOrderId',
                        'catalog_purchase_order',
                        'CASCADE',
                    ),
                    foreignKey('FK_catalog_purchase_line_variant', 'variantId', 'product_variant'),
                ],
            }),
        );
        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_purchase_receipt',
                columns: [
                    ...baseColumns(),
                    { name: 'purchaseOrderId', type: idType },
                    { name: 'code', type: 'varchar', length: '64' },
                    { name: 'idempotencyKey', type: 'varchar', length: '80' },
                    { name: 'supplierDeliveryReference', type: 'varchar', length: '120', isNullable: true },
                    { name: 'receivedAt', type: dateType },
                    { name: 'receivedByUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'notes', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_purchase_receipt_order_key',
                        columnNames: ['purchaseOrderId', 'idempotencyKey'],
                        isUnique: true,
                    },
                    { name: 'IDX_catalog_purchase_receipt_code', columnNames: ['code'], isUnique: true },
                ],
                foreignKeys: [
                    foreignKey(
                        'FK_catalog_purchase_receipt_order',
                        'purchaseOrderId',
                        'catalog_purchase_order',
                    ),
                ],
            }),
        );
        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_purchase_receipt_line',
                columns: [
                    ...baseColumns(),
                    { name: 'receiptId', type: idType },
                    { name: 'purchaseOrderLineId', type: idType },
                    { name: 'inventoryLotId', type: idType, isNullable: true },
                    { name: 'receivedQuantity', type: 'int' },
                    { name: 'acceptedQuantity', type: 'int' },
                    { name: 'rejectedQuantity', type: 'int' },
                    { name: 'lotCode', type: 'varchar', length: '80', isNullable: true },
                    { name: 'manufacturedAt', type: dateType, isNullable: true },
                    { name: 'expiresAt', type: dateType, isNullable: true },
                    { name: 'unitCostMicrounits', type: 'bigint' },
                    { name: 'rejectionReason', type: 'varchar', length: '500', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_purchase_receipt_line_receipt_order_line',
                        columnNames: ['receiptId', 'purchaseOrderLineId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    foreignKey(
                        'FK_catalog_purchase_receipt_line_receipt',
                        'receiptId',
                        'catalog_purchase_receipt',
                        'CASCADE',
                    ),
                    foreignKey(
                        'FK_catalog_purchase_receipt_line_order_line',
                        'purchaseOrderLineId',
                        'catalog_purchase_order_line',
                    ),
                    foreignKey(
                        'FK_catalog_purchase_receipt_line_lot',
                        'inventoryLotId',
                        'catalog_inventory_lot',
                    ),
                ],
            }),
        );
        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_purchase_order_event',
                columns: [
                    ...baseColumns(),
                    { name: 'purchaseOrderId', type: idType },
                    { name: 'type', type: 'varchar', length: '40' },
                    { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'summary', type: 'varchar', length: '500' },
                    { name: 'details', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_purchase_order_event_order_created',
                        columnNames: ['purchaseOrderId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey(
                        'FK_catalog_purchase_event_order',
                        'purchaseOrderId',
                        'catalog_purchase_order',
                    ),
                ],
            }),
        );
        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_purchase_supplier_return',
                columns: [
                    ...baseColumns(),
                    { name: 'purchaseOrderId', type: idType },
                    { name: 'code', type: 'varchar', length: '64' },
                    { name: 'idempotencyKey', type: 'varchar', length: '80' },
                    {
                        name: 'supplierAcknowledgementReference',
                        type: 'varchar',
                        length: '120',
                        isNullable: true,
                    },
                    { name: 'returnedAt', type: dateType },
                    { name: 'returnedByUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'notes', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_purchase_return_order_key',
                        columnNames: ['purchaseOrderId', 'idempotencyKey'],
                        isUnique: true,
                    },
                    { name: 'IDX_catalog_purchase_return_code', columnNames: ['code'], isUnique: true },
                ],
                foreignKeys: [
                    foreignKey(
                        'FK_catalog_purchase_return_order',
                        'purchaseOrderId',
                        'catalog_purchase_order',
                    ),
                ],
            }),
        );
        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_purchase_supplier_return_line',
                columns: [
                    ...baseColumns(),
                    { name: 'supplierReturnId', type: idType },
                    { name: 'purchaseOrderLineId', type: idType },
                    { name: 'inventoryLotId', type: idType },
                    { name: 'quantity', type: 'int' },
                    { name: 'unitCostMicrounits', type: 'bigint' },
                    { name: 'creditMicrounits', type: 'bigint' },
                    { name: 'reason', type: 'varchar', length: '500' },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_purchase_return_line_return_order_line_lot',
                        columnNames: ['supplierReturnId', 'purchaseOrderLineId', 'inventoryLotId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    foreignKey(
                        'FK_catalog_purchase_return_line_return',
                        'supplierReturnId',
                        'catalog_purchase_supplier_return',
                        'CASCADE',
                    ),
                    foreignKey(
                        'FK_catalog_purchase_return_line_order_line',
                        'purchaseOrderLineId',
                        'catalog_purchase_order_line',
                    ),
                    foreignKey(
                        'FK_catalog_purchase_return_line_lot',
                        'inventoryLotId',
                        'catalog_inventory_lot',
                    ),
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain purchase orders, receipts, payments, and inventory audit evidence'),
        );
    }
}

async function createIfMissing(runner: QueryRunner, table: Table): Promise<void> {
    if (!(await runner.hasTable(table.name))) await runner.createTable(table);
}
