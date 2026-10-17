import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCatalogImportExecutionLease1792195200000 } from './1792195200000-add-catalog-import-execution-lease';

describe('catalog import execution lease migration', () => {
    it('is additive, reentrant, leaves legacy running jobs unchanged and refuses destructive rollback', async () => {
        const db = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = db.createQueryRunner();
        try {
            await runner.createTable(
                new Table({
                    name: 'catalog_import_job',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'state', type: 'varchar', length: '24' },
                        { name: 'version', type: 'integer' },
                        { name: 'progress', type: 'integer' },
                    ],
                }),
            );
            await runner.query(
                "INSERT INTO catalog_import_job VALUES (1, 'RUNNING', 7, 42), (2, 'COMPLETED', 3, 100)",
            );
            const before = await runner.query('SELECT * FROM catalog_import_job ORDER BY id');
            const migration = new AddCatalogImportExecutionLease1792195200000();
            await migration.up(runner);
            await migration.up(runner);
            const table = await runner.getTable('catalog_import_job');
            expect(table?.findColumnByName('executionToken')).toMatchObject({
                type: 'varchar',
                length: '36',
                isNullable: true,
            });
            expect(table?.findColumnByName('leaseUntil')).toMatchObject({
                type: 'datetime',
                isNullable: true,
            });
            expect(
                table?.indices.filter(index => index.name === 'IDX_catalog_import_job_state_lease'),
            ).toHaveLength(1);
            expect(
                await runner.query('SELECT id, state, version, progress FROM catalog_import_job ORDER BY id'),
            ).toEqual(before);
            expect(await runner.query('SELECT executionToken, leaseUntil FROM catalog_import_job')).toEqual([
                { executionToken: null, leaseUntil: null },
                { executionToken: null, leaseUntil: null },
            ]);
            await expect(migration.down()).rejects.toThrow('Retain import execution leases');
            expect(await runner.hasColumn('catalog_import_job', 'executionToken')).toBe(true);
        } finally {
            await runner.release();
            await db.destroy();
        }
    });
    it('refuses missing target tables rather than silently claiming migration success', async () => {
        const db = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        try {
            await expect(
                new AddCatalogImportExecutionLease1792195200000().up(db.createQueryRunner()),
            ).rejects.toThrow('must exist');
        } finally {
            await db.destroy();
        }
    });
});
