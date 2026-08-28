import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddInventoryLotMovements1787835600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('catalog_inventory_lot_movement')) return;

        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';

        await queryRunner.createTable(
            new Table({
                name: 'catalog_inventory_lot_movement',
                columns: [
                    {
                        name: 'createdAt',
                        type: dateType,
                        ...(isMysql ? { precision: 6 } : {}),
                        default: now,
                    },
                    {
                        name: 'updatedAt',
                        type: dateType,
                        ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                        default: now,
                    },
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'lotId', type: idType },
                    { name: 'stockMovementId', type: idType },
                    { name: 'orderLineId', type: idType, isNullable: true },
                    { name: 'variantId', type: idType },
                    { name: 'stockLocationId', type: idType },
                    { name: 'type', type: 'varchar', length: '24' },
                    { name: 'quantity', type: 'int' },
                    { name: 'actorId', type: 'varchar', length: '64', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_catalog_lot_movement_stock_lot',
                        columnNames: ['stockMovementId', 'lotId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_catalog_lot_movement_order_line',
                        columnNames: ['orderLineId', 'variantId', 'stockLocationId'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_catalog_lot_movement_lot',
                        columnNames: ['lotId'],
                        referencedTableName: 'catalog_inventory_lot',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                    {
                        name: 'FK_catalog_lot_movement_stock',
                        columnNames: ['stockMovementId'],
                        referencedTableName: 'stock_movement',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                    {
                        name: 'FK_catalog_lot_movement_order_line',
                        columnNames: ['orderLineId'],
                        referencedTableName: 'order_line',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                    {
                        name: 'FK_catalog_lot_movement_variant',
                        columnNames: ['variantId'],
                        referencedTableName: 'product_variant',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                    {
                        name: 'FK_catalog_lot_movement_location',
                        columnNames: ['stockLocationId'],
                        referencedTableName: 'stock_location',
                        referencedColumnNames: ['id'],
                        onDelete: 'RESTRICT',
                    },
                ],
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('catalog_inventory_lot_movement')) {
            await queryRunner.dropTable('catalog_inventory_lot_movement');
        }
    }
}
