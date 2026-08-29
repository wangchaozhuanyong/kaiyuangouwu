import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions, TableIndex } from 'typeorm';

const AUDIT_TERMS_VERSION = '2026-08-28-audit';
const AUDIT_TERMS_ZH =
    '我确认拥有提示词和参考图的使用权；内容会发送至第三方中转站及模型提供方；生成结果可能存在错误；禁止违法、侵权、冒充、欺诈及未成年人敏感内容。参考图在任务结束后保留24小时。客户删除生成记录时，图片会删除且前台记录会隐藏；提示词、计费和调用记录为安全审计长期保留，合规删除或匿名化需另行申请。';
const AUDIT_TERMS_EN = [
    'I have rights to the prompt and reference image.',
    'Content is sent to the relay and model provider. AI output may be inaccurate.',
    'Illegal, infringing, deceptive, impersonation, fraud, and sensitive minor content are prohibited.',
    'References are kept 24 hours after completion.',
    'Customer deletion removes images and hides storefront history; prompts, billing, and invocation records',
    'are retained for security audit until a separately authorized compliance deletion or anonymization request',
    'is completed.',
].join(' ');

export class AddImageUsageBillingAndKeyPool1787832000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanTrue = databaseType === 'postgres' ? true : 1;
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

        await this.addColumns(queryRunner, 'image_generation_config', [
            { name: 'promptRateLimitPerMinute', type: 'int', default: 3 },
            { name: 'promptDailyFreeLimit', type: 'int', default: 20 },
            { name: 'promptDailyFreeUnlimited', type: booleanType, default: booleanFalse },
            { name: 'paidPromptOptimizationEnabled', type: booleanType, default: booleanFalse },
            { name: 'paidPromptOptimizationPrice', type: 'int', default: 0 },
            { name: 'paidPromptOptimizationCurrencyCode', type: 'varchar', length: '3', default: "'CNY'" },
        ]);
        await this.addColumns(queryRunner, 'image_model_config', [
            { name: 'freeImageEnabled', type: booleanType, default: booleanFalse },
            { name: 'dailyFreeImageLimit', type: 'int', default: 0 },
            { name: 'dailyFreeImageUnlimited', type: booleanType, default: booleanFalse },
            { name: 'paidAfterFreeEnabled', type: booleanType, default: booleanTrue },
            { name: 'dailyGenerationSafetyLimit', type: 'int', default: 20 },
        ]);
        await this.addColumns(queryRunner, 'image_generation_job', [
            { name: 'providerCredentialCodeSnapshot', type: 'varchar', length: '64', default: "''" },
            { name: 'providerCredentialNameSnapshot', type: 'varchar', length: '120', default: "''" },
            { name: 'providerCredentialLast4Snapshot', type: 'varchar', length: '8', default: "''" },
            { name: 'providerSelectionReason', type: 'varchar', length: '160', isNullable: true },
            { name: 'expectedChargeAmount', type: 'int', default: 0 },
            { name: 'freeQuantityReserved', type: 'int', default: 0 },
            { name: 'freeQuantityCaptured', type: 'int', default: 0 },
            { name: 'paidQuantityReserved', type: 'int', default: 0 },
            { name: 'quotaEventId', type: idType, isNullable: true },
            { name: 'customerDeletedAt', type: dateType, isNullable: true },
        ]);
        await this.addColumns(queryRunner, 'image_generation_output', [
            { name: 'billingMode', type: 'varchar', length: '16', default: "'PENDING'" },
            { name: 'chargeAmount', type: 'int', default: 0 },
        ]);
        await this.addColumns(queryRunner, 'image_generation_cost_event', [
            { name: 'credentialCodeSnapshot', type: 'varchar', length: '64', default: "''" },
            { name: 'credentialNameSnapshot', type: 'varchar', length: '120', default: "''" },
            { name: 'credentialLast4Snapshot', type: 'varchar', length: '8', default: "''" },
            { name: 'credentialSelectionReason', type: 'varchar', length: '160', isNullable: true },
        ]);
        await this.addColumns(queryRunner, 'image_prompt_optimization', [
            { name: 'idempotencyKey', type: 'varchar', length: '64', isNullable: true },
            { name: 'billingMode', type: 'varchar', length: '16', default: "'FREE'" },
            { name: 'chargedAmount', type: 'int', default: 0 },
            { name: 'currencyCode', type: 'varchar', length: '3', default: "'CNY'" },
            { name: 'walletUsageId', type: idType, isNullable: true },
            { name: 'quotaEventId', type: idType, isNullable: true },
            { name: 'inputTokens', type: 'int', isNullable: true },
            { name: 'outputTokens', type: 'int', isNullable: true },
            { name: 'totalTokens', type: 'int', isNullable: true },
            { name: 'actualCostMicrounits', type: 'int', isNullable: true },
            { name: 'costCurrency', type: 'varchar', length: '3', isNullable: true },
            { name: 'providerRequestId', type: 'varchar', length: '200', isNullable: true },
            { name: 'credentialCodeSnapshot', type: 'varchar', length: '64', default: "''" },
            { name: 'credentialNameSnapshot', type: 'varchar', length: '120', default: "''" },
            { name: 'credentialLast4Snapshot', type: 'varchar', length: '8', default: "''" },
            { name: 'credentialSelectionReason', type: 'varchar', length: '160', isNullable: true },
            { name: 'upstreamCallCount', type: 'int', default: 0 },
            { name: 'latencyMs', type: 'int', default: 0 },
            { name: 'errorMessage', type: 'varchar', length: '500', isNullable: true },
        ]);

        await queryRunner.manager.update(
            'image_generation_config',
            { termsVersion: '2026-08-27' },
            {
                termsVersion: AUDIT_TERMS_VERSION,
                termsZh: AUDIT_TERMS_ZH,
                termsEn: AUDIT_TERMS_EN,
            },
        );

        await this.migrateCredentialTable(queryRunner, booleanType, booleanFalse, dateType);

        await this.createIfMissing(
            queryRunner,
            new Table({
                name: 'image_compliance_audit_event',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'actorId', type: idType, isNullable: true },
                    { name: 'customerIdSnapshot', type: 'varchar', length: '64' },
                    { name: 'action', type: 'varchar', length: '32' },
                    { name: 'reason', type: 'varchar', length: '500' },
                    { name: 'affectedPromptRecords', type: 'int', default: 0 },
                    { name: 'affectedJobs', type: 'int', default: 0 },
                    { name: 'metadata', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_image_compliance_audit_channel_created',
                        columnNames: ['channelId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_image_compliance_audit_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
        );
        await this.createIfMissing(
            queryRunner,
            new Table({
                name: 'image_usage_quota_bucket',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'quotaType', type: 'varchar', length: '32' },
                    { name: 'modelCode', type: 'varchar', length: '48', default: "''" },
                    { name: 'windowKey', type: 'varchar', length: '32' },
                    { name: 'windowStartsAt', type: dateType },
                    { name: 'windowEndsAt', type: dateType },
                    { name: 'limitSnapshot', type: 'int' },
                    { name: 'unlimited', type: booleanType, default: booleanFalse },
                    { name: 'reserved', type: 'int', default: 0 },
                    { name: 'consumed', type: 'int', default: 0 },
                    { name: 'released', type: 'int', default: 0 },
                    { name: 'version', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_image_usage_quota_bucket_unique',
                        columnNames: ['channelId', 'customerId', 'quotaType', 'modelCode', 'windowKey'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_image_usage_quota_bucket_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_image_usage_quota_bucket_customer',
                        columnNames: ['customerId'],
                        referencedTableName: 'customer',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
        );
        await this.createIfMissing(
            queryRunner,
            new Table({
                name: 'image_usage_quota_event',
                columns: [
                    ...baseColumns(),
                    { name: 'bucketId', type: idType },
                    { name: 'idempotencyKey', type: 'varchar', length: '96' },
                    { name: 'resourceType', type: 'varchar', length: '32' },
                    { name: 'resourceId', type: 'varchar', length: '64' },
                    { name: 'amount', type: 'int' },
                    { name: 'consumedAmount', type: 'int', default: 0 },
                    { name: 'releasedAmount', type: 'int', default: 0 },
                    { name: 'state', type: 'varchar', length: '16', default: "'RESERVED'" },
                    { name: 'consumedAt', type: dateType, isNullable: true },
                    { name: 'releasedAt', type: dateType, isNullable: true },
                    { name: 'metadata', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_image_usage_quota_event_idempotency',
                        columnNames: ['idempotencyKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_image_usage_quota_event_resource',
                        columnNames: ['resourceType', 'resourceId'],
                    },
                ],
            }),
        );
        await this.createIfMissing(
            queryRunner,
            new Table({
                name: 'image_provider_credential_model',
                columns: [
                    ...baseColumns(),
                    { name: 'credentialId', type: idType },
                    { name: 'modelConfigId', type: idType },
                ],
                indices: [
                    {
                        name: 'IDX_image_provider_credential_model_unique',
                        columnNames: ['credentialId', 'modelConfigId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_image_provider_model_credential',
                        columnNames: ['credentialId'],
                        referencedTableName: 'image_provider_credential',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_image_provider_model_model',
                        columnNames: ['modelConfigId'],
                        referencedTableName: 'image_model_config',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
        );
        await this.bindLegacyCredentials(queryRunner);
        const promptTable = await queryRunner.getTable('image_prompt_optimization');
        if (!promptTable?.indices.some(index => index.name === 'IDX_image_prompt_optimization_idempotency')) {
            await queryRunner.createIndex(
                'image_prompt_optimization',
                new TableIndex({
                    name: 'IDX_image_prompt_optimization_idempotency',
                    columnNames: ['channelId', 'customerId', 'idempotencyKey'],
                    isUnique: true,
                }),
            );
        }
    }

    public async down(): Promise<void> {
        // 数据保留迁移：额度、扣费和审计记录不能通过自动回滚删除。
    }

    private async migrateCredentialTable(
        queryRunner: QueryRunner,
        booleanType: TableColumnOptions['type'],
        booleanFalse: boolean | number,
        dateType: TableColumnOptions['type'],
    ): Promise<void> {
        await this.addColumns(queryRunner, 'image_provider_credential', [
            { name: 'code', type: 'varchar', length: '64', isNullable: true },
            { name: 'name', type: 'varchar', length: '120', isNullable: true },
            { name: 'purpose', type: 'varchar', length: '24', default: "'BOTH'" },
            { name: 'priority', type: 'int', default: 100 },
            { name: 'weight', type: 'int', default: 1 },
            { name: 'currentWeight', type: 'int', default: 0 },
            { name: 'consecutiveFailures', type: 'int', default: 0 },
            { name: 'cooldownUntil', type: dateType, isNullable: true },
            { name: 'lastUsedAt', type: dateType, isNullable: true },
            { name: 'archivedAt', type: dateType, isNullable: true },
        ]);
        const rows = (await queryRunner.query('SELECT id, scope FROM image_provider_credential')) as Array<{
            id: string | number;
            scope: string;
        }>;
        for (const row of rows) {
            const scope = String(row.scope || 'GLOBAL').toUpperCase();
            await queryRunner.manager.update(
                'image_provider_credential',
                { id: row.id },
                { code: `${scope.toLowerCase()}-primary-${row.id}`, name: `${scope} 主 Key` },
            );
        }
        const table = await queryRunner.getTable('image_provider_credential');
        if (!table) return;
        const oldIndex = table.indices.find(index => index.name === 'IDX_image_provider_credential_scope');
        if (oldIndex) await queryRunner.dropIndex(table, oldIndex);
        for (const columnName of ['code', 'name']) {
            const current = (await queryRunner.getTable('image_provider_credential'))?.findColumnByName(
                columnName,
            );
            if (current?.isNullable) {
                const next = current.clone();
                next.isNullable = false;
                await queryRunner.changeColumn('image_provider_credential', current, next);
            }
        }
        const refreshed = await queryRunner.getTable('image_provider_credential');
        if (!refreshed?.indices.some(index => index.name === 'IDX_image_provider_credential_code')) {
            await queryRunner.createIndex(
                'image_provider_credential',
                new TableIndex({
                    name: 'IDX_image_provider_credential_code',
                    columnNames: ['code'],
                    isUnique: true,
                }),
            );
        }
        if (!refreshed?.indices.some(index => index.name === 'IDX_image_provider_credential_route')) {
            await queryRunner.createIndex(
                'image_provider_credential',
                new TableIndex({
                    name: 'IDX_image_provider_credential_route',
                    columnNames: ['scope', 'enabled', 'priority'],
                }),
            );
        }
        void booleanType;
        void booleanFalse;
    }

    private async bindLegacyCredentials(queryRunner: QueryRunner): Promise<void> {
        const credentials = (await queryRunner.query(
            'SELECT id, scope FROM image_provider_credential',
        )) as Array<{
            id: string | number;
            scope: string;
        }>;
        const models = (await queryRunner.query(
            'SELECT id, protocol, providerModelId FROM image_model_config',
        )) as Array<{
            id: string | number;
            protocol: string;
            providerModelId: string;
        }>;
        for (const credential of credentials) {
            for (const model of models) {
                const modelScope =
                    String(model.protocol).startsWith('GEMINI_') ||
                    String(model.providerModelId).toLowerCase().includes('gemini')
                        ? 'GEMINI'
                        : 'OPENAI';
                if (modelScope !== String(credential.scope).toUpperCase()) continue;
                await queryRunner.manager.insert('image_provider_credential_model', {
                    credentialId: credential.id,
                    modelConfigId: model.id,
                });
            }
        }
    }

    private async addColumns(queryRunner: QueryRunner, tableName: string, columns: TableColumnOptions[]) {
        let table = await queryRunner.getTable(tableName);
        if (!table) return;
        for (const column of columns) {
            if (table.findColumnByName(column.name)) continue;
            await queryRunner.addColumn(tableName, new TableColumn(column));
            table = await queryRunner.getTable(tableName);
            if (!table) break;
        }
    }

    private async createIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
        if (!(await queryRunner.hasTable(table.name))) await queryRunner.createTable(table, true);
    }
}
