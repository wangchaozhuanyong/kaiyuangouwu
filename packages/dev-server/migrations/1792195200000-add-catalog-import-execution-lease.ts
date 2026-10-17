import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/** Additive only: legacy RUNNING jobs remain unowned until an explicit reviewed recovery. */
export class AddCatalogImportExecutionLease1792195200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasTable('catalog_import_job')))
            throw new Error('catalog_import_job must exist before adding execution leases');
        const driver = runner.connection.options.type;
        const mysql = driver === 'mysql' || driver === 'mariadb';
        const dateType = driver === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const columns = [
            new TableColumn({ name: 'executionToken', type: 'varchar', length: '36', isNullable: true }),
            new TableColumn({
                name: 'leaseUntil',
                type: dateType,
                isNullable: true,
                ...(mysql || driver === 'postgres' ? { precision: 6 } : {}),
            }),
        ];
        for (const expected of columns) {
            const currentTable = await runner.getTable('catalog_import_job');
            const current = currentTable?.findColumnByName(expected.name);
            if (!current) {
                await runner.addColumn('catalog_import_job', expected);
            } else if (
                current.type !== expected.type ||
                !current.isNullable ||
                (expected.length && current.length !== expected.length) ||
                (expected.precision != null && current.precision !== expected.precision)
            ) {
                throw new Error('Incompatible catalog import lease column: ' + expected.name);
            }
        }
        const table = await runner.getTable('catalog_import_job');
        const name = 'IDX_catalog_import_job_state_lease';
        const existing = table?.indices.find(index => index.name === name);
        if (!existing) {
            await runner.createIndex(
                'catalog_import_job',
                new TableIndex({
                    name,
                    columnNames: ['state', 'leaseUntil'],
                    isUnique: false,
                }),
            );
        } else if (existing.isUnique || existing.columnNames.join(',') !== 'state,leaseUntil') {
            throw new Error('Incompatible catalog import lease index');
        }
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error(
                'Retain import execution leases; stop imports and review compatible forward recovery before reverting',
            ),
        );
    }
}
