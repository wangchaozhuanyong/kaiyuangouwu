import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

export class HardenImageGeneration1787817600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('image_generation_job'))) return;
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanFalse = databaseType === 'postgres' ? false : 0;
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

        await addColumnIfMissing(
            queryRunner,
            'image_model_config',
            new TableColumn({ name: 'supportsIdempotency', type: booleanType, default: booleanFalse }),
        );
        await addColumnIfMissing(
            queryRunner,
            'image_model_config',
            new TableColumn({ name: 'consecutiveFailures', type: 'int', default: 0 }),
        );
        await addColumnIfMissing(
            queryRunner,
            'image_generation_job',
            new TableColumn({
                name: 'providerScopeSnapshot',
                type: 'varchar',
                length: '24',
                default: "'OPENAI'",
            }),
        );
        await addColumnIfMissing(
            queryRunner,
            'image_generation_job',
            new TableColumn({
                name: 'providerCredentialFingerprint',
                type: 'varchar',
                length: '64',
                default: "''",
            }),
        );
        await addColumnIfMissing(
            queryRunner,
            'image_generation_job',
            new TableColumn({
                name: 'providerIdempotencySupportedSnapshot',
                type: booleanType,
                default: booleanFalse,
            }),
        );
        await backfillProviderScopes(queryRunner, isMysql);

        if (!(await queryRunner.hasTable('image_generation_dispatch'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'image_generation_dispatch',
                    columns: [
                        ...baseColumns(),
                        { name: 'outputId', type: idType },
                        { name: 'state', type: 'varchar', length: '24', default: "'PENDING'" },
                        { name: 'attemptCount', type: 'int', default: 0 },
                        { name: 'nextAttemptAt', type: dateType, default: now },
                        { name: 'dispatchedAt', type: dateType, isNullable: true },
                        { name: 'lastError', type: 'varchar', length: '500', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_image_generation_dispatch_output',
                            columnNames: ['outputId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_image_generation_dispatch_state_next',
                            columnNames: ['state', 'nextAttemptAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_image_generation_dispatch_output',
                            columnNames: ['outputId'],
                            referencedTableName: 'image_generation_output',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('image_generation_cost_event'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'image_generation_cost_event',
                    columns: [
                        ...baseColumns(),
                        { name: 'channelId', type: idType },
                        { name: 'jobIdSnapshot', type: 'varchar', length: '64' },
                        { name: 'outputIdSnapshot', type: 'varchar', length: '64' },
                        { name: 'attemptNumber', type: 'int' },
                        { name: 'modelCodeSnapshot', type: 'varchar', length: '48' },
                        { name: 'providerScopeSnapshot', type: 'varchar', length: '24' },
                        { name: 'credentialFingerprint', type: 'varchar', length: '64' },
                        { name: 'saleUnitPriceSnapshot', type: 'int' },
                        { name: 'saleCurrencyCode', type: 'varchar', length: '3' },
                        { name: 'outcome', type: 'varchar', length: '24' },
                        { name: 'httpStatus', type: 'int', isNullable: true },
                        { name: 'providerRequestId', type: 'varchar', length: '200', isNullable: true },
                        { name: 'latencyMs', type: 'int' },
                        { name: 'actualCostMicrounits', type: 'int', isNullable: true },
                        { name: 'costCurrency', type: 'varchar', length: '3', isNullable: true },
                        { name: 'usage', type: 'text', isNullable: true },
                        { name: 'errorMessage', type: 'varchar', length: '500', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_image_generation_cost_output_attempt',
                            columnNames: ['outputIdSnapshot', 'attemptNumber'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_image_generation_cost_channel_created',
                            columnNames: ['channelId', 'createdAt'],
                        },
                        {
                            name: 'IDX_image_generation_cost_model_created',
                            columnNames: ['modelCodeSnapshot', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_image_generation_cost_channel',
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

        await backfillQueuedDispatches(queryRunner, now, isMysql);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('image_generation_cost_event')) {
            await queryRunner.dropTable('image_generation_cost_event', true);
        }
        if (await queryRunner.hasTable('image_generation_dispatch')) {
            await queryRunner.dropTable('image_generation_dispatch', true);
        }
        for (const [table, column] of [
            ['image_generation_job', 'providerIdempotencySupportedSnapshot'],
            ['image_generation_job', 'providerCredentialFingerprint'],
            ['image_generation_job', 'providerScopeSnapshot'],
            ['image_model_config', 'consecutiveFailures'],
            ['image_model_config', 'supportsIdempotency'],
        ] as const) {
            if ((await queryRunner.hasTable(table)) && (await queryRunner.hasColumn(table, column))) {
                await queryRunner.dropColumn(table, column);
            }
        }
    }
}

async function addColumnIfMissing(
    queryRunner: QueryRunner,
    table: string,
    column: TableColumn,
): Promise<void> {
    if ((await queryRunner.hasTable(table)) && !(await queryRunner.hasColumn(table, column.name))) {
        await queryRunner.addColumn(table, column);
    }
}

async function backfillQueuedDispatches(queryRunner: QueryRunner, nowExpression: string, isMysql: boolean) {
    const quote = (value: string) => (isMysql ? `\`${value}\`` : `"${value}"`);
    await queryRunner.query(
        `INSERT INTO ${quote('image_generation_dispatch')} (
             ${quote('createdAt')}, ${quote('updatedAt')}, ${quote('outputId')},
             ${quote('state')}, ${quote('attemptCount')}, ${quote('nextAttemptAt')}
         )
         SELECT ${nowExpression}, ${nowExpression}, image_output.${quote('id')}, 'PENDING', 0, ${nowExpression}
         FROM ${quote('image_generation_output')} image_output
         WHERE image_output.${quote('state')} = 'QUEUED'
           AND NOT EXISTS (
               SELECT 1 FROM ${quote('image_generation_dispatch')} image_dispatch
               WHERE image_dispatch.${quote('outputId')} = image_output.${quote('id')}
           )`,
    );
}

async function backfillProviderScopes(queryRunner: QueryRunner, isMysql: boolean) {
    const quote = (value: string) => (isMysql ? `\`${value}\`` : `"${value}"`);
    await queryRunner.query(
        `UPDATE ${quote('image_generation_job')}
         SET ${quote('providerScopeSnapshot')} = 'GEMINI'
         WHERE ${quote('protocolSnapshot')} IN ('GEMINI_INTERACTIONS', 'GEMINI_NATIVE', 'GEMINI_NATIVE_STREAM')
            OR LOWER(${quote('providerModelIdSnapshot')}) LIKE 'gemini-%'
            OR LOWER(${quote('providerModelIdSnapshot')}) LIKE 'models/gemini-%'
            OR LOWER(${quote('providerModelIdSnapshot')}) LIKE 'imagen-%'
            OR LOWER(${quote('providerModelIdSnapshot')}) LIKE 'models/imagen-%'`,
    );
}
