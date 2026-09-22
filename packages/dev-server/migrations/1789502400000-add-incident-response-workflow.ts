import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

const incidentTableName = 'admin_notification_outbox';
const evidenceTableName = 'admin_incident_evidence';
const actionTableName = 'admin_incident_action';

export class AddIncidentResponseWorkflow1789502400000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        let incidentTable = await runner.getTable(incidentTableName);
        if (!incidentTable) throw new Error('Admin notification outbox must exist before incident workflow');
        const type = String(runner.connection.options.type);
        const dateType = ['postgres', 'aurora-postgres'].includes(type)
            ? 'timestamp without time zone'
            : 'datetime';
        const incidentColumns = [
            new TableColumn({
                name: 'incidentStatus',
                type: 'varchar',
                length: '24',
                default: "'NOT_APPLICABLE'",
            }),
            new TableColumn({ name: 'acknowledgedAt', type: dateType, isNullable: true }),
            new TableColumn({
                name: 'acknowledgedByUserId',
                type: 'varchar',
                length: '128',
                isNullable: true,
            }),
            new TableColumn({
                name: 'acknowledgementNote',
                type: 'varchar',
                length: '1000',
                isNullable: true,
            }),
            new TableColumn({ name: 'recoveryObservedAt', type: dateType, isNullable: true }),
            new TableColumn({ name: 'recoveryValidationDueAt', type: dateType, isNullable: true }),
            new TableColumn({ name: 'recoveryValidatedAt', type: dateType, isNullable: true }),
            new TableColumn({
                name: 'recoveryValidatedByUserId',
                type: 'varchar',
                length: '128',
                isNullable: true,
            }),
            new TableColumn({
                name: 'recoveryValidationNote',
                type: 'varchar',
                length: '1000',
                isNullable: true,
            }),
            new TableColumn({ name: 'recoveryEscalatedAt', type: dateType, isNullable: true }),
            new TableColumn({ name: 'reviewDueAt', type: dateType, isNullable: true }),
            new TableColumn({ name: 'reviewSubmittedAt', type: dateType, isNullable: true }),
            new TableColumn({
                name: 'reviewSubmittedByUserId',
                type: 'varchar',
                length: '128',
                isNullable: true,
            }),
            new TableColumn({ name: 'rootCause', type: 'varchar', length: '2000', isNullable: true }),
            new TableColumn({ name: 'impactSummary', type: 'varchar', length: '2000', isNullable: true }),
            new TableColumn({ name: 'reviewEscalatedAt', type: dateType, isNullable: true }),
            new TableColumn({ name: 'closedAt', type: dateType, isNullable: true }),
        ];
        for (const column of incidentColumns) {
            if (!incidentTable.findColumnByName(column.name)) {
                await runner.addColumn(incidentTableName, column);
                const incidentTableAfterColumn = await runner.getTable(incidentTableName);
                if (!incidentTableAfterColumn) {
                    throw new Error(
                        'Admin notification outbox disappeared during incident workflow migration',
                    );
                }
                incidentTable = incidentTableAfterColumn;
            }
        }
        const escape = (name: string) => runner.connection.driver.escape(name);
        await runner.query(
            `UPDATE ${escape(incidentTableName)}
             SET ${escape('incidentStatus')} = CASE
                 WHEN ${escape('mode')} <> 'INCIDENT' THEN 'NOT_APPLICABLE'
                 WHEN ${escape('eventState')} = 'RESOLVED' THEN 'CLOSED'
                 ELSE 'OPEN'
             END
             WHERE ${escape('incidentStatus')} = 'NOT_APPLICABLE'`,
        );
        const refreshedIncidentTable = await runner.getTable(incidentTableName);
        if (!refreshedIncidentTable) {
            throw new Error('Admin notification outbox disappeared during incident workflow migration');
        }
        incidentTable = refreshedIncidentTable;
        if (!incidentTable.indices.some(index => index.name === 'IDX_admin_incident_status_severity')) {
            await runner.createIndex(
                incidentTableName,
                new TableIndex({
                    name: 'IDX_admin_incident_status_severity',
                    columnNames: ['mode', 'incidentStatus', 'severity', 'createdAt'],
                }),
            );
        }
        if (!incidentTable.indices.some(index => index.name === 'IDX_admin_incident_recovery_due')) {
            await runner.createIndex(
                incidentTableName,
                new TableIndex({
                    name: 'IDX_admin_incident_recovery_due',
                    columnNames: ['incidentStatus', 'recoveryValidationDueAt'],
                }),
            );
        }
        if (!incidentTable.indices.some(index => index.name === 'IDX_admin_incident_review_due')) {
            await runner.createIndex(
                incidentTableName,
                new TableIndex({
                    name: 'IDX_admin_incident_review_due',
                    columnNames: ['incidentStatus', 'reviewDueAt'],
                }),
            );
        }

        const id = incidentTable.findColumnByName('id');
        if (!id) throw new Error('Admin incident id column is missing');
        const identity = id.clone();
        identity.name = 'id';
        identity.isPrimary = true;
        identity.isGenerated = true;
        identity.generationStrategy = 'increment';
        const incidentId = () => ({
            name: 'incidentId',
            type: id.type,
            length: id.length,
            unsigned: id.unsigned,
        });
        if (!(await runner.hasTable(evidenceTableName))) {
            await runner.createTable(
                new Table({
                    name: evidenceTableName,
                    columns: [
                        identity.clone(),
                        { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                        { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                        incidentId(),
                        { name: 'eventId', type: 'varchar', length: '36' },
                        { name: 'eventType', type: 'varchar', length: '32' },
                        { name: 'actorType', type: 'varchar', length: '16' },
                        { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'summary', type: 'varchar', length: '500' },
                        { name: 'evidence', type: 'text' },
                        { name: 'occurredAt', type: dateType },
                        { name: 'evidenceHash', type: 'varchar', length: '64' },
                    ],
                    indices: [
                        {
                            name: 'IDX_admin_incident_evidence_incident_created',
                            columnNames: ['incidentId', 'createdAt'],
                        },
                        {
                            name: 'IDX_admin_incident_evidence_event_id',
                            columnNames: ['eventId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_admin_incident_evidence_hash',
                            columnNames: ['evidenceHash'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_admin_incident_evidence_incident',
                            columnNames: ['incidentId'],
                            referencedTableName: incidentTableName,
                            referencedColumnNames: ['id'],
                            onDelete: 'RESTRICT',
                        },
                    ],
                }),
            );
        }
        if (!(await runner.hasTable(actionTableName))) {
            await runner.createTable(
                new Table({
                    name: actionTableName,
                    columns: [
                        identity.clone(),
                        { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                        { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                        incidentId(),
                        { name: 'title', type: 'varchar', length: '500' },
                        { name: 'ownerDepartmentCode', type: 'varchar', length: '32' },
                        { name: 'dueAt', type: dateType },
                        { name: 'status', type: 'varchar', length: '16', default: "'OPEN'" },
                        { name: 'completedAt', type: dateType, isNullable: true },
                        { name: 'completedByUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'completionNote', type: 'varchar', length: '1000', isNullable: true },
                        { name: 'escalatedAt', type: dateType, isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_admin_incident_action_incident_status',
                            columnNames: ['incidentId', 'status'],
                        },
                        {
                            name: 'IDX_admin_incident_action_due',
                            columnNames: ['status', 'dueAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_admin_incident_action_incident',
                            columnNames: ['incidentId'],
                            referencedTableName: incidentTableName,
                            referencedColumnNames: ['id'],
                            onDelete: 'RESTRICT',
                        },
                    ],
                }),
            );
        }
        await assertTableColumns(runner, evidenceTableName, [
            'id',
            'createdAt',
            'updatedAt',
            'incidentId',
            'eventId',
            'eventType',
            'actorType',
            'actorUserId',
            'summary',
            'evidence',
            'occurredAt',
            'evidenceHash',
        ]);
        await assertTableColumns(runner, actionTableName, [
            'id',
            'createdAt',
            'updatedAt',
            'incidentId',
            'title',
            'ownerDepartmentCode',
            'dueAt',
            'status',
            'completedAt',
            'completedByUserId',
            'completionNote',
            'escalatedAt',
        ]);
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain incident response evidence during rollback'));
    }
}

async function assertTableColumns(runner: QueryRunner, tableName: string, expected: string[]) {
    const table = await runner.getTable(tableName);
    if (!table) throw new Error(`Incident response table ${tableName} is missing`);
    const missing = expected.filter(name => !table.findColumnByName(name));
    if (missing.length) {
        throw new Error(`Incident response table ${tableName} is incomplete: ${missing.join(', ')}`);
    }
}
