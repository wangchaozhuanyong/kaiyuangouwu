import {
    MigrationInterface,
    QueryRunner,
    TableColumn,
    TableColumnOptions,
    TableForeignKey,
    TableIndex,
} from 'typeorm';

export class CloseAfterSalesWorkflow1789596000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const databaseType = String(runner.connection.options.type);
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';

        await addColumns(runner, 'after_sales_request', [
            { name: 'returnStatus', type: 'varchar', length: '32', default: "'NOT_REQUIRED'" },
            { name: 'returnInstructions', type: 'text', isNullable: true },
            { name: 'returnCarrier', type: 'varchar', length: '120', isNullable: true },
            { name: 'returnTrackingCode', type: 'varchar', length: '160', isNullable: true },
            { name: 'returnShippedAt', type: dateType, isNullable: true },
            { name: 'returnReceivedAt', type: dateType, isNullable: true },
            { name: 'inspectedAt', type: dateType, isNullable: true },
            { name: 'inspectionNote', type: 'text', isNullable: true },
            { name: 'replacementStatus', type: 'varchar', length: '32', default: "'NOT_REQUIRED'" },
            { name: 'replacementCarrier', type: 'varchar', length: '120', isNullable: true },
            { name: 'replacementTrackingCode', type: 'varchar', length: '160', isNullable: true },
            { name: 'replacementProofReference', type: 'varchar', length: '255', isNullable: true },
            { name: 'replacementException', type: 'text', isNullable: true },
            { name: 'replacementShippedAt', type: dateType, isNullable: true },
            { name: 'replacementDeliveredAt', type: dateType, isNullable: true },
            { name: 'nextActionDueAt', type: dateType, isNullable: true },
        ]);
        await addColumns(runner, 'after_sales_item', [
            { name: 'acceptedReturnQuantity', type: 'int', default: 0 },
            { name: 'rejectedReturnQuantity', type: 'int', default: 0 },
            { name: 'returnLotCode', type: 'varchar', length: '80', isNullable: true },
            { name: 'inventoryOperationId', type: 'varchar', length: '128', isNullable: true },
            { name: 'returnStockLocationId', type: idType, isNullable: true },
        ]);
        await addColumns(runner, 'after_sales_event', [
            { name: 'eventType', type: 'varchar', length: '48', default: "'STATE_CHANGED'" },
            { name: 'idempotencyKey', type: 'varchar', length: '80', isNullable: true },
        ]);

        const itemTable = await runner.getTable('after_sales_item');
        if (
            itemTable &&
            !itemTable.foreignKeys.some(key => key.name === 'FK_after_sales_item_return_location')
        ) {
            await runner.createForeignKey(
                itemTable,
                new TableForeignKey({
                    name: 'FK_after_sales_item_return_location',
                    columnNames: ['returnStockLocationId'],
                    referencedTableName: 'stock_location',
                    referencedColumnNames: ['id'],
                    onDelete: 'SET NULL',
                }),
            );
        }
        const eventTable = await runner.getTable('after_sales_event');
        if (
            eventTable &&
            !eventTable.indices.some(index => index.name === 'IDX_after_sales_event_request_key')
        ) {
            await runner.createIndex(
                eventTable,
                new TableIndex({
                    name: 'IDX_after_sales_event_request_key',
                    columnNames: ['requestId', 'idempotencyKey'],
                    isUnique: true,
                }),
            );
        }
        const requestTable = await runner.getTable('after_sales_request');
        if (
            requestTable &&
            !requestTable.indices.some(index => index.name === 'IDX_after_sales_request_next_action')
        ) {
            await runner.createIndex(
                requestTable,
                new TableIndex({
                    name: 'IDX_after_sales_request_next_action',
                    columnNames: ['channelId', 'nextActionDueAt'],
                }),
            );
        }
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain after-sales return, inspection, and replacement evidence'));
    }
}

async function addColumns(
    runner: QueryRunner,
    tableName: string,
    columns: TableColumnOptions[],
): Promise<void> {
    const table = await runner.getTable(tableName);
    if (!table) throw new Error(`Required table ${tableName} is missing`);
    for (const column of columns) {
        if (!table.findColumnByName(column.name)) {
            await runner.addColumn(table, new TableColumn(column));
            if (!table.findColumnByName(column.name)) table.addColumn(new TableColumn(column));
        }
    }
}
