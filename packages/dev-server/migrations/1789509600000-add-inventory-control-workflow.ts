import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddInventoryControlWorkflow1789509600000 implements MigrationInterface {
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

        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_inventory_operation',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'code', type: 'varchar', length: '64' },
                    { name: 'idempotencyKey', type: 'varchar', length: '80' },
                    { name: 'type', type: 'varchar', length: '32' },
                    { name: 'status', type: 'varchar', length: '16', default: "'POSTED'" },
                    { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                    { name: 'reason', type: 'varchar', length: '500' },
                    { name: 'reference', type: 'varchar', length: '160', isNullable: true },
                    { name: 'postedAt', type: dateType },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_inventory_operation_channel_key',
                        columnNames: ['channelId', 'idempotencyKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_catalog_inventory_operation_channel_created',
                        columnNames: ['channelId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_catalog_inventory_operation_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
        );

        await createIfMissing(
            runner,
            new Table({
                name: 'catalog_inventory_operation_line',
                columns: [
                    ...baseColumns(),
                    { name: 'operationId', type: idType },
                    { name: 'variantId', type: idType },
                    { name: 'stockLocationId', type: idType },
                    { name: 'inventoryLotId', type: idType, isNullable: true },
                    { name: 'quantityDelta', type: 'int' },
                    { name: 'previousLotQuantity', type: 'int' },
                    { name: 'resultingLotQuantity', type: 'int' },
                    { name: 'previousStockOnHand', type: 'int' },
                    { name: 'resultingStockOnHand', type: 'int' },
                    { name: 'reconciliationMode', type: 'varchar', length: '32', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_inventory_operation_line_operation',
                        columnNames: ['operationId'],
                    },
                    {
                        name: 'IDX_catalog_inventory_operation_line_scope',
                        columnNames: ['variantId', 'stockLocationId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_catalog_inventory_line_operation',
                        columnNames: ['operationId'],
                        referencedTableName: 'catalog_inventory_operation',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                    {
                        name: 'FK_catalog_inventory_line_variant',
                        columnNames: ['variantId'],
                        referencedTableName: 'product_variant',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                    {
                        name: 'FK_catalog_inventory_line_location',
                        columnNames: ['stockLocationId'],
                        referencedTableName: 'stock_location',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                    {
                        name: 'FK_catalog_inventory_line_lot',
                        columnNames: ['inventoryLotId'],
                        referencedTableName: 'catalog_inventory_lot',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain inventory adjustments, transfers, and reconciliation evidence'),
        );
    }
}

async function createIfMissing(runner: QueryRunner, table: Table): Promise<void> {
    if (!(await runner.hasTable(table.name))) await runner.createTable(table);
}
