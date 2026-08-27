import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddImageGeneration1787792400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
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
        const foreignKey = (
            name: string,
            columnName: string,
            referencedTableName: string,
            onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE',
        ) => ({
            name,
            columnNames: [columnName],
            referencedTableName,
            referencedColumnNames: ['id'],
            onDelete,
        });

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'referral_wallet_usage',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'walletId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'resourceType', type: 'varchar', length: '48' },
                    { name: 'resourceId', type: 'varchar', length: '128' },
                    { name: 'idempotencyKey', type: 'varchar', length: '255' },
                    { name: 'amount', type: 'int' },
                    { name: 'capturedAmount', type: 'int', default: 0 },
                    { name: 'releasedAmount', type: 'int', default: 0 },
                    { name: 'status', type: 'varchar', length: '24', default: "'RESERVED'" },
                    { name: 'reservedAt', type: dateType },
                    { name: 'settledAt', type: dateType, isNullable: true },
                    { name: 'metadata', type: 'text', isNullable: true },
                    { name: 'version', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_referral_wallet_usage_idempotency',
                        columnNames: ['idempotencyKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_referral_wallet_usage_resource',
                        columnNames: ['channelId', 'resourceType', 'resourceId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_referral_wallet_usage_customer_created',
                        columnNames: ['customerId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_referral_wallet_usage_channel', 'channelId', 'channel'),
                    foreignKey('FK_referral_wallet_usage_wallet', 'walletId', 'referral_wallet'),
                    foreignKey('FK_referral_wallet_usage_customer', 'customerId', 'customer'),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_generation_config',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'enabled', type: booleanType, default: booleanFalse },
                    { name: 'promptOptimizationEnabled', type: booleanType, default: booleanTrue },
                    {
                        name: 'defaultModelCode',
                        type: 'varchar',
                        length: '48',
                        default: "'OPENAI_HIGH_QUALITY'",
                    },
                    { name: 'termsVersion', type: 'varchar', length: '32', default: "'2026-08-27'" },
                    { name: 'termsZh', type: 'text' },
                    { name: 'termsEn', type: 'text' },
                ],
                indices: [
                    {
                        name: 'IDX_image_generation_config_channel',
                        columnNames: ['channelId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [foreignKey('FK_image_generation_config_channel', 'channelId', 'channel')],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_provider_credential',
                columns: [
                    ...baseColumns(),
                    { name: 'scope', type: 'varchar', length: '24', default: "'GLOBAL'" },
                    { name: 'enabled', type: booleanType, default: booleanFalse },
                    { name: 'baseUrl', type: 'varchar', length: '500' },
                    { name: 'encryptedApiKey', type: 'text' },
                    { name: 'apiKeyLast4', type: 'varchar', length: '8', default: "''" },
                    { name: 'textModelId', type: 'varchar', length: '160' },
                    { name: 'lastTestedAt', type: dateType, isNullable: true },
                    { name: 'healthStatus', type: 'varchar', length: '24', default: "'UNTESTED'" },
                    { name: 'healthMessage', type: 'varchar', length: '500', isNullable: true },
                ],
                indices: [
                    { name: 'IDX_image_provider_credential_scope', columnNames: ['scope'], isUnique: true },
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_model_config',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'code', type: 'varchar', length: '48' },
                    { name: 'enabled', type: booleanType, default: booleanFalse },
                    { name: 'displayNameZh', type: 'varchar', length: '120' },
                    { name: 'displayNameEn', type: 'varchar', length: '120' },
                    { name: 'descriptionZh', type: 'varchar', length: '500' },
                    { name: 'descriptionEn', type: 'varchar', length: '500' },
                    { name: 'officialModelId', type: 'varchar', length: '160' },
                    { name: 'providerModelId', type: 'varchar', length: '160' },
                    { name: 'protocol', type: 'varchar', length: '32' },
                    { name: 'unitPrice', type: 'int', default: 0 },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'position', type: 'int', default: 0 },
                    { name: 'isDefault', type: booleanType, default: booleanFalse },
                    { name: 'healthStatus', type: 'varchar', length: '24', default: "'UNTESTED'" },
                    { name: 'healthMessage', type: 'varchar', length: '500', isNullable: true },
                    { name: 'lastTestedAt', type: dateType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_image_model_config_channel_code',
                        columnNames: ['channelId', 'code'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_image_model_config_channel_position',
                        columnNames: ['channelId', 'position'],
                    },
                ],
                foreignKeys: [foreignKey('FK_image_model_config_channel', 'channelId', 'channel')],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_prompt_skill_release',
                columns: [
                    ...baseColumns(),
                    { name: 'bundleVersion', type: 'int' },
                    { name: 'sourceHash', type: 'varchar', length: '64' },
                    { name: 'status', type: 'varchar', length: '24', default: "'INACTIVE'" },
                    { name: 'bundle', type: 'text' },
                    { name: 'activatedAt', type: dateType, isNullable: true },
                ],
                indices: [
                    { name: 'IDX_image_prompt_skill_hash', columnNames: ['sourceHash'], isUnique: true },
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_prompt_optimization',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'inputPrompt', type: 'text' },
                    { name: 'optimizedPrompt', type: 'text' },
                    { name: 'promptSpec', type: 'text' },
                    { name: 'source', type: 'varchar', length: '16' },
                    { name: 'optimizerModelId', type: 'varchar', length: '160', isNullable: true },
                    { name: 'promptSkillHash', type: 'varchar', length: '64' },
                    { name: 'recommendedModelCode', type: 'varchar', length: '48' },
                    { name: 'recommendationReason', type: 'varchar', length: '300' },
                ],
                indices: [
                    {
                        name: 'IDX_image_prompt_optimization_customer_created',
                        columnNames: ['channelId', 'customerId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_image_prompt_optimization_channel', 'channelId', 'channel'),
                    foreignKey('FK_image_prompt_optimization_customer', 'customerId', 'customer'),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_private_asset',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'kind', type: 'varchar', length: '16' },
                    { name: 'storageKey', type: 'varchar', length: '255', isUnique: true },
                    { name: 'originalName', type: 'varchar', length: '80' },
                    { name: 'mimeType', type: 'varchar', length: '64' },
                    { name: 'byteSize', type: 'int' },
                    { name: 'width', type: 'int' },
                    { name: 'height', type: 'int' },
                    { name: 'sha256', type: 'varchar', length: '64' },
                    { name: 'expiresAt', type: dateType },
                    { name: 'deletedAt', type: dateType, isNullable: true },
                    { name: 'providerMetadata', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_image_private_asset_owner_created',
                        columnNames: ['customerId', 'createdAt'],
                    },
                    { name: 'IDX_image_private_asset_expiry', columnNames: ['expiresAt'] },
                ],
                foreignKeys: [
                    foreignKey('FK_image_private_asset_channel', 'channelId', 'channel'),
                    foreignKey('FK_image_private_asset_customer', 'customerId', 'customer'),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_generation_job',
                columns: [
                    ...baseColumns(),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'modelConfigId', type: idType },
                    { name: 'referenceAssetId', type: idType, isNullable: true },
                    { name: 'idempotencyKey', type: 'varchar', length: '64' },
                    { name: 'modelCodeSnapshot', type: 'varchar', length: '48' },
                    { name: 'modelNameSnapshot', type: 'varchar', length: '120' },
                    { name: 'officialModelIdSnapshot', type: 'varchar', length: '160' },
                    { name: 'providerModelIdSnapshot', type: 'varchar', length: '160' },
                    { name: 'protocolSnapshot', type: 'varchar', length: '32' },
                    { name: 'originalPrompt', type: 'text' },
                    { name: 'finalPrompt', type: 'text' },
                    { name: 'promptSpec', type: 'text', isNullable: true },
                    { name: 'promptSkillHash', type: 'varchar', length: '64' },
                    { name: 'referenceMode', type: 'varchar', length: '24', default: "'NONE'" },
                    { name: 'aspectRatio', type: 'varchar', length: '8' },
                    { name: 'quantity', type: 'int' },
                    { name: 'unitPriceSnapshot', type: 'int' },
                    { name: 'reservedAmount', type: 'int' },
                    { name: 'capturedAmount', type: 'int', default: 0 },
                    { name: 'releasedAmount', type: 'int', default: 0 },
                    { name: 'currencyCode', type: 'varchar', length: '3' },
                    { name: 'walletUsageId', type: idType, isNullable: true },
                    { name: 'state', type: 'varchar', length: '24', default: "'QUEUED'" },
                    { name: 'termsVersion', type: 'varchar', length: '32' },
                    { name: 'termsAcceptedAt', type: dateType },
                    { name: 'errorMessage', type: 'varchar', length: '500', isNullable: true },
                    { name: 'completedAt', type: dateType, isNullable: true },
                    { name: 'version', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_image_generation_job_idempotency',
                        columnNames: ['channelId', 'customerId', 'idempotencyKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_image_generation_job_customer_created',
                        columnNames: ['customerId', 'createdAt'],
                    },
                    { name: 'IDX_image_generation_job_state_created', columnNames: ['state', 'createdAt'] },
                ],
                foreignKeys: [
                    foreignKey('FK_image_generation_job_channel', 'channelId', 'channel'),
                    foreignKey('FK_image_generation_job_customer', 'customerId', 'customer'),
                    foreignKey(
                        'FK_image_generation_job_model',
                        'modelConfigId',
                        'image_model_config',
                        'RESTRICT',
                    ),
                    foreignKey(
                        'FK_image_generation_job_reference',
                        'referenceAssetId',
                        'image_private_asset',
                        'SET NULL',
                    ),
                ],
            }),
        );

        await createIfMissing(
            queryRunner,
            new Table({
                name: 'image_generation_output',
                columns: [
                    ...baseColumns(),
                    { name: 'jobId', type: idType },
                    { name: 'outputIndex', type: 'int' },
                    { name: 'state', type: 'varchar', length: '24', default: "'QUEUED'" },
                    { name: 'attemptCount', type: 'int', default: 0 },
                    { name: 'providerIdempotencyKey', type: 'varchar', length: '160' },
                    { name: 'providerRequestId', type: 'varchar', length: '200', isNullable: true },
                    { name: 'assetId', type: idType, isNullable: true },
                    { name: 'errorMessage', type: 'varchar', length: '500', isNullable: true },
                    { name: 'unknownAt', type: dateType, isNullable: true },
                    { name: 'completedAt', type: dateType, isNullable: true },
                    { name: 'walletSettled', type: booleanType, default: booleanFalse },
                    { name: 'refundedAt', type: dateType, isNullable: true },
                    { name: 'version', type: 'int', default: 1 },
                ],
                indices: [
                    {
                        name: 'IDX_image_generation_output_job_index',
                        columnNames: ['jobId', 'outputIndex'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_image_generation_output_state_updated',
                        columnNames: ['state', 'updatedAt'],
                    },
                ],
                foreignKeys: [
                    foreignKey('FK_image_generation_output_job', 'jobId', 'image_generation_job'),
                    foreignKey(
                        'FK_image_generation_output_asset',
                        'assetId',
                        'image_private_asset',
                        'SET NULL',
                    ),
                ],
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of [
            'image_generation_output',
            'image_generation_job',
            'image_private_asset',
            'image_prompt_optimization',
            'image_prompt_skill_release',
            'image_model_config',
            'image_provider_credential',
            'image_generation_config',
            'referral_wallet_usage',
        ]) {
            if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table, true);
        }
    }
}

async function createIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
    if (!(await queryRunner.hasTable(table.name))) await queryRunner.createTable(table, true);
}
