import { DataSource, QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddIncidentResponseWorkflow1789502400000 } from './1789502400000-add-incident-response-workflow';

describe('incident response workflow migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds portable incident lifecycle and append-only evidence tables on %s',
        async databaseType => {
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const incident = incidentTable(idType);
            const tables = new Map<string, Table>([[incident.name, incident]]);
            const createTable = vi.fn((table: Table) => {
                tables.set(table.name, table);
                return Promise.resolve();
            });
            const addColumn = vi.fn((_name: string, column: TableColumn) => {
                incident.addColumn(column);
                return Promise.resolve();
            });
            await new AddIncidentResponseWorkflow1789502400000().up({
                connection: {
                    options: { type: databaseType },
                    driver: { escape: (name: string) => `"${name}"` },
                },
                getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
                addColumn,
                query: vi.fn().mockResolvedValue([]),
                createIndex: vi.fn().mockResolvedValue(undefined),
                hasTable: vi.fn().mockResolvedValue(false),
                createTable,
            } as unknown as QueryRunner);

            expect(addColumn.mock.calls.map(call => call[1].name)).toEqual(
                expect.arrayContaining([
                    'incidentStatus',
                    'acknowledgedAt',
                    'recoveryValidationDueAt',
                    'reviewDueAt',
                    'closedAt',
                ]),
            );
            const created = createTable.mock.calls.map(call => call[0]);
            const evidence = created.find(table => table.name === 'admin_incident_evidence');
            const action = created.find(table => table.name === 'admin_incident_action');
            expect(evidence?.findColumnByName('incidentId')?.type).toBe(idType);
            expect(evidence?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'IDX_admin_incident_evidence_event_id', isUnique: true }),
                    expect.objectContaining({ name: 'IDX_admin_incident_evidence_hash', isUnique: true }),
                ]),
            );
            expect(action?.findColumnByName('incidentId')?.type).toBe(idType);
            expect(action?.findColumnByName('completionNote')?.length).toBe('1000');
            expect(evidence?.foreignKeys[0]).toMatchObject({ onDelete: 'RESTRICT' });
            expect(action?.foreignKeys[0]).toMatchObject({ onDelete: 'RESTRICT' });
        },
    );

    it('is idempotent on SQL.js, backfills legacy lifecycle, and retains evidence on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(incidentTable('integer'));
            await runner.query(
                `INSERT INTO admin_notification_outbox (mode, eventState, severity)
                 VALUES ('ONE_OFF', 'INFO', 'P2'), ('INCIDENT', 'FIRING', 'P1'), ('INCIDENT', 'RESOLVED', 'P0')`,
            );
            const migration = new AddIncidentResponseWorkflow1789502400000();
            await migration.up(runner);
            await migration.up(runner);
            const rows = (await runner.query(
                'SELECT incidentStatus FROM admin_notification_outbox ORDER BY id',
            )) as Array<{ incidentStatus: string }>;
            expect(rows.map(row => row.incidentStatus)).toEqual(['NOT_APPLICABLE', 'OPEN', 'CLOSED']);
            await expect(runner.hasTable('admin_incident_evidence')).resolves.toBe(true);
            await expect(runner.hasTable('admin_incident_action')).resolves.toBe(true);
            await expect(migration.down()).rejects.toThrow('Retain incident response evidence');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});

function incidentTable(idType: string): Table {
    return new Table({
        name: 'admin_notification_outbox',
        columns: [
            {
                name: 'id',
                type: idType,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment',
            },
            { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
            { name: 'mode', type: 'varchar', length: '16' },
            { name: 'eventState', type: 'varchar', length: '16' },
            { name: 'severity', type: 'varchar', length: '2' },
        ],
    });
}
