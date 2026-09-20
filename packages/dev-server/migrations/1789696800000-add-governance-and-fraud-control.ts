import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddGovernanceAndFraudControl1789696800000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const databaseType = String(runner.connection.options.type);
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const timestamps = () => [
            { name: 'createdAt', type: dateType, ...(isMysql ? { precision: 6 } : {}), default: now },
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
                generationStrategy: 'increment' as const,
            },
        ];
        const channelForeignKey = (name: string) => ({
            name,
            columnNames: ['channelId'],
            referencedTableName: 'channel',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE' as const,
        });

        if (!(await runner.hasTable('governed_config_version'))) {
            await runner.createTable(
                new Table({
                    name: 'governed_config_version',
                    columns: [
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'namespace', type: 'varchar', length: '40' },
                        { name: 'version', type: 'int' },
                        { name: 'status', type: 'varchar', length: '16' },
                        { name: 'payloadJson', type: 'text' },
                        { name: 'payloadHash', type: 'varchar', length: '64' },
                        { name: 'createdByUserId', type: 'varchar', length: '128' },
                        { name: 'activatedAt', type: dateType, isNullable: true },
                        { name: 'retiredAt', type: dateType, isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'UQ_governed_config_version',
                            columnNames: ['channelId', 'namespace', 'version'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_governed_config_active',
                            columnNames: ['channelId', 'namespace', 'status'],
                        },
                    ],
                    foreignKeys: [channelForeignKey('FK_governed_config_channel')],
                }),
            );
        }

        if (!(await runner.hasTable('governance_approval_request'))) {
            await runner.createTable(
                new Table({
                    name: 'governance_approval_request',
                    columns: [
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'configVersionId', type: idType },
                        { name: 'status', type: 'varchar', length: '16' },
                        { name: 'requestedByUserId', type: 'varchar', length: '128' },
                        { name: 'requestReason', type: 'varchar', length: '500' },
                        { name: 'expiresAt', type: dateType },
                        { name: 'reviewedByUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'reviewReason', type: 'varchar', length: '500', isNullable: true },
                        { name: 'reviewedAt', type: dateType, isNullable: true },
                        { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    ],
                    indices: [
                        {
                            name: 'UQ_governance_approval_key',
                            columnNames: ['channelId', 'idempotencyKey'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_governance_approval_queue',
                            columnNames: ['channelId', 'status', 'expiresAt'],
                        },
                    ],
                    foreignKeys: [
                        channelForeignKey('FK_governance_approval_channel'),
                        {
                            name: 'FK_governance_approval_config',
                            columnNames: ['configVersionId'],
                            referencedTableName: 'governed_config_version',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
        }

        if (!(await runner.hasTable('governance_audit_entry'))) {
            await runner.createTable(
                new Table({
                    name: 'governance_audit_entry',
                    columns: [
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'sequence', type: 'int' },
                        { name: 'eventType', type: 'varchar', length: '80' },
                        { name: 'resourceType', type: 'varchar', length: '80' },
                        { name: 'resourceId', type: 'varchar', length: '160' },
                        { name: 'actorType', type: 'varchar', length: '16' },
                        { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'actorLabel', type: 'varchar', length: '160' },
                        { name: 'reason', type: 'varchar', length: '500' },
                        { name: 'payloadJson', type: 'text' },
                        { name: 'payloadHash', type: 'varchar', length: '64' },
                        { name: 'previousHash', type: 'varchar', length: '64', isNullable: true },
                        { name: 'entryHash', type: 'varchar', length: '64' },
                        { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    ],
                    indices: [
                        {
                            name: 'UQ_governance_audit_sequence',
                            columnNames: ['channelId', 'sequence'],
                            isUnique: true,
                        },
                        {
                            name: 'UQ_governance_audit_key',
                            columnNames: ['channelId', 'idempotencyKey'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_governance_audit_resource',
                            columnNames: ['channelId', 'resourceType', 'resourceId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [channelForeignKey('FK_governance_audit_channel')],
                }),
            );
        }

        if (!(await runner.hasTable('governance_report_snapshot'))) {
            await runner.createTable(
                new Table({
                    name: 'governance_report_snapshot',
                    columns: [
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'businessDate', type: 'varchar', length: '10' },
                        { name: 'windowStartedAt', type: dateType },
                        { name: 'windowEndedAt', type: dateType },
                        { name: 'metricsJson', type: 'text' },
                        { name: 'digest', type: 'varchar', length: '64' },
                        { name: 'auditIntegrityValid', type: 'boolean', default: true },
                        { name: 'anomalyCount', type: 'int', default: 0 },
                    ],
                    indices: [
                        {
                            name: 'UQ_governance_report_date',
                            columnNames: ['channelId', 'businessDate'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [channelForeignKey('FK_governance_report_channel')],
                }),
            );
        }

        if (!(await runner.hasTable('fraud_risk_case'))) {
            await runner.createTable(
                new Table({
                    name: 'fraud_risk_case',
                    columns: [
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'caseCode', type: 'varchar', length: '32' },
                        { name: 'subjectType', type: 'varchar', length: '24' },
                        { name: 'subjectId', type: 'varchar', length: '128' },
                        { name: 'orderId', type: idType, isNullable: true },
                        { name: 'customerId', type: idType, isNullable: true },
                        { name: 'status', type: 'varchar', length: '16' },
                        { name: 'severity', type: 'varchar', length: '8' },
                        { name: 'riskScore', type: 'int' },
                        { name: 'ruleVersion', type: 'varchar', length: '64' },
                        { name: 'subjectDigest', type: 'varchar', length: '64' },
                        { name: 'signalsJson', type: 'text' },
                        { name: 'recommendedAction', type: 'varchar', length: '40' },
                        { name: 'dueAt', type: dateType },
                        { name: 'ownerUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'decisionCode', type: 'varchar', length: '32', isNullable: true },
                        { name: 'decisionReason', type: 'varchar', length: '500', isNullable: true },
                        { name: 'decidedByUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'decidedAt', type: dateType, isNullable: true },
                        { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    ],
                    indices: [
                        {
                            name: 'UQ_fraud_risk_case_key',
                            columnNames: ['channelId', 'idempotencyKey'],
                            isUnique: true,
                        },
                        { name: 'UQ_fraud_risk_case_code', columnNames: ['caseCode'], isUnique: true },
                        {
                            name: 'UQ_fraud_risk_case_subject_digest',
                            columnNames: [
                                'channelId',
                                'subjectType',
                                'subjectId',
                                'ruleVersion',
                                'subjectDigest',
                            ],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_fraud_risk_case_queue',
                            columnNames: ['channelId', 'status', 'severity', 'dueAt'],
                        },
                        {
                            name: 'IDX_fraud_risk_case_subject',
                            columnNames: ['channelId', 'subjectType', 'subjectId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [channelForeignKey('FK_fraud_risk_case_channel')],
                }),
            );
        }

        if (!(await runner.hasTable('fraud_risk_case_event'))) {
            await runner.createTable(
                new Table({
                    name: 'fraud_risk_case_event',
                    columns: [
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'riskCaseId', type: idType },
                        { name: 'eventType', type: 'varchar', length: '32' },
                        { name: 'actorType', type: 'varchar', length: '16' },
                        { name: 'actorUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'note', type: 'varchar', length: '500' },
                        { name: 'payloadJson', type: 'text', isNullable: true },
                        { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    ],
                    indices: [
                        {
                            name: 'UQ_fraud_risk_event_key',
                            columnNames: ['riskCaseId', 'idempotencyKey'],
                            isUnique: true,
                        },
                        { name: 'IDX_fraud_risk_event_timeline', columnNames: ['riskCaseId', 'createdAt'] },
                    ],
                    foreignKeys: [
                        channelForeignKey('FK_fraud_risk_event_channel'),
                        {
                            name: 'FK_fraud_risk_event_case',
                            columnNames: ['riskCaseId'],
                            referencedTableName: 'fraud_risk_case',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
        }

        if (!(await runner.hasTable('fraud_risk_appeal'))) {
            await runner.createTable(
                new Table({
                    name: 'fraud_risk_appeal',
                    columns: [
                        ...timestamps(),
                        { name: 'channelId', type: idType },
                        { name: 'riskCaseId', type: idType },
                        { name: 'customerId', type: idType, isNullable: true },
                        { name: 'status', type: 'varchar', length: '16' },
                        { name: 'reason', type: 'varchar', length: '1000' },
                        { name: 'response', type: 'varchar', length: '1000', isNullable: true },
                        { name: 'reviewedByUserId', type: 'varchar', length: '128', isNullable: true },
                        { name: 'reviewedAt', type: dateType, isNullable: true },
                        { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    ],
                    indices: [
                        {
                            name: 'UQ_fraud_risk_appeal_key',
                            columnNames: ['riskCaseId', 'idempotencyKey'],
                            isUnique: true,
                        },
                        {
                            name: 'UQ_fraud_risk_appeal_case',
                            columnNames: ['riskCaseId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_fraud_risk_appeal_queue',
                            columnNames: ['channelId', 'status', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        channelForeignKey('FK_fraud_risk_appeal_channel'),
                        {
                            name: 'FK_fraud_risk_appeal_case',
                            columnNames: ['riskCaseId'],
                            referencedTableName: 'fraud_risk_case',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
        }
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain governance approvals, audit evidence and fraud-review decisions'),
        );
    }
}
