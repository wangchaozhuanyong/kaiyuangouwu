import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

const attemptColumns: TableColumnOptions[] = [
    {
        name: 'optimizationIdSnapshot',
        type: 'varchar',
        length: '64',
    },
    {
        name: 'attemptNumber',
        type: 'int',
    },
    {
        name: 'stage',
        type: 'varchar',
        length: '16',
    },
    {
        name: 'outcome',
        type: 'varchar',
        length: '24',
    },
    {
        name: 'modelId',
        type: 'varchar',
        length: '160',
    },
    {
        name: 'providerScope',
        type: 'varchar',
        length: '24',
    },
    {
        name: 'credentialCodeSnapshot',
        type: 'varchar',
        length: '64',
    },
    {
        name: 'credentialNameSnapshot',
        type: 'varchar',
        length: '120',
    },
    {
        name: 'credentialLast4Snapshot',
        type: 'varchar',
        length: '8',
    },
    {
        name: 'credentialSelectionReason',
        type: 'varchar',
        length: '160',
        isNullable: true,
    },
    {
        name: 'providerRequestId',
        type: 'varchar',
        length: '200',
        isNullable: true,
    },
    {
        name: 'callId',
        type: 'varchar',
        length: '36',
    },
    {
        name: 'headerRequestId',
        type: 'varchar',
        length: '200',
        isNullable: true,
    },
    {
        name: 'headerRequestIdSource',
        type: 'varchar',
        length: '48',
        isNullable: true,
    },
    {
        name: 'modelResponseId',
        type: 'varchar',
        length: '200',
        isNullable: true,
    },
    {
        name: 'costSource',
        type: 'varchar',
        length: '32',
        isNullable: true,
    },
    {
        name: 'reportedCostEvidence',
        type: 'text',
        isNullable: true,
    },
    {
        name: 'httpStatus',
        type: 'int',
        isNullable: true,
    },
    {
        name: 'latencyMs',
        type: 'int',
        default: 0,
    },
    {
        name: 'actualCostMicrounits',
        type: 'int',
        isNullable: true,
    },
    {
        name: 'costCurrency',
        type: 'varchar',
        length: '3',
        isNullable: true,
    },
    {
        name: 'usage',
        type: 'text',
        isNullable: true,
    },
    {
        name: 'completedAt',
        type: 'datetime',
        isNullable: true,
    },
    {
        name: 'errorMessage',
        type: 'varchar',
        length: '100',
        isNullable: true,
    },
];
const traceColumns: TableColumnOptions[] = [
    {
        name: 'callId',
        type: 'varchar',
        length: '36',
        isNullable: true,
    },
    {
        name: 'headerRequestId',
        type: 'varchar',
        length: '200',
        isNullable: true,
    },
    {
        name: 'headerRequestIdSource',
        type: 'varchar',
        length: '48',
        isNullable: true,
    },
    {
        name: 'modelResponseId',
        type: 'varchar',
        length: '200',
        isNullable: true,
    },
    {
        name: 'costSource',
        type: 'varchar',
        length: '32',
        isNullable: true,
    },
    {
        name: 'reportedCostEvidence',
        type: 'text',
        isNullable: true,
    },
];

export class AddImageProviderAttemptLedger1789272000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const db = runner.connection.options.type;
        const mysql = db === 'mysql' || db === 'mariadb';
        const dateType = db === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const idType =
            db === 'postgres' || db === 'sqljs' || db === 'sqlite' || db === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const now = mysql ? 'CURRENT_TIMESTAMP(6)' : 'CURRENT_TIMESTAMP';
        for (const column of traceColumns) {
            if (!(await runner.hasColumn('image_generation_cost_event', column.name))) {
                await runner.addColumn('image_generation_cost_event', new TableColumn(column));
            }
        }
        if (!(await runner.hasColumn('image_prompt_optimization', 'attemptLedgerVersion'))) {
            await runner.addColumn(
                'image_prompt_optimization',
                new TableColumn({ name: 'attemptLedgerVersion', type: 'int', isNullable: true }),
            );
        }
        if (!(await runner.hasTable('image_prompt_optimization_attempt'))) {
            await runner.createTable(
                new Table({
                    name: 'image_prompt_optimization_attempt',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        ...['createdAt', 'updatedAt'].map(name => ({
                            name,
                            type: dateType,
                            ...(mysql ? { precision: 6 } : {}),
                            default: now,
                        })),
                        { name: 'channelId', type: idType },
                        ...attemptColumns.map(column =>
                            column.type === 'datetime' ? { ...column, type: dateType } : column,
                        ),
                    ],
                    indices: [
                        { name: 'IDX_image_prompt_attempt_call', columnNames: ['callId'], isUnique: true },
                        {
                            name: 'IDX_image_prompt_attempt_order',
                            columnNames: ['optimizationIdSnapshot', 'attemptNumber'],
                            isUnique: true,
                        },
                        { name: 'IDX_image_prompt_attempt_channel', columnNames: ['channelId', 'createdAt'] },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_image_prompt_attempt_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error('费用审计结构包含历史证据，禁止自动删除；回退应用时保留增量表和字段。'),
        );
    }
}
