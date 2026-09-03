import { MigrationInterface, QueryRunner, Table, TableColumnOptions, TableIndex } from 'typeorm';

type LegacyPromptRouting = {
    singletonKey: string;
    strategy: string;
    primaryCredentialCode: string | null;
    primaryModelId: string | null;
    fallbackEnabled: boolean | number | string;
    fallbackCredentialCode: string | null;
    fallbackModelId: string | null;
};

type LegacyProviderCredential = {
    id: string | number;
    scope: string;
    code: string;
    name: string;
    purpose: string;
    enabled: boolean | number | string;
    baseUrl: string;
    encryptedApiKey: string;
    apiKeyLast4: string;
    textModelId: string;
    priority: number;
    weight: number;
    currentWeight: number;
    healthStatus: string;
    healthMessage: string | null;
    lastTestedAt: Date | string | null;
    consecutiveFailures: number;
    cooldownUntil: Date | string | null;
    lastUsedAt: Date | string | null;
    archivedAt: Date | string | null;
};

type PromptModelSeed = {
    code: string;
    name: string;
    enabled: boolean;
    baseUrl: string;
    encryptedApiKey: string;
    apiKeyLast4: string;
    modelId: string;
    apiFormat: 'OPENAI' | 'GEMINI';
    priority: number;
    weight: number;
    currentWeight: number;
    healthStatus: string;
    healthMessage: string | null;
    lastTestedAt: Date | string | null;
    consecutiveFailures: number;
    cooldownUntil: Date | string | null;
    lastUsedAt: Date | string | null;
    archivedAt: null;
};

const PROMPT_MODEL_TABLE = 'image_prompt_model_config';

export class AddImagePromptModelConfigs1788436800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanFalse = databaseType === 'postgres' ? false : 0;

        if (!(await queryRunner.hasTable(PROMPT_MODEL_TABLE))) {
            await queryRunner.createTable(
                new Table({
                    name: PROMPT_MODEL_TABLE,
                    columns: [
                        {
                            name: 'createdAt',
                            type: dateType,
                            ...(isMysql ? { precision: 6 } : {}),
                            default: now,
                        },
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
                            generationStrategy: 'increment',
                        },
                        { name: 'code', type: 'varchar', length: '64' },
                        { name: 'name', type: 'varchar', length: '120' },
                        { name: 'enabled', type: booleanType, default: booleanFalse },
                        { name: 'baseUrl', type: 'varchar', length: '500' },
                        { name: 'encryptedApiKey', type: 'text' },
                        { name: 'apiKeyLast4', type: 'varchar', length: '8', default: "''" },
                        { name: 'modelId', type: 'varchar', length: '160' },
                        { name: 'apiFormat', type: 'varchar', length: '24', default: "''" },
                        { name: 'priority', type: 'int', default: 100 },
                        { name: 'weight', type: 'int', default: 1 },
                        { name: 'currentWeight', type: 'int', default: 0 },
                        { name: 'healthStatus', type: 'varchar', length: '24', default: "'UNTESTED'" },
                        { name: 'healthMessage', type: 'varchar', length: '500', isNullable: true },
                        { name: 'lastTestedAt', type: dateType, isNullable: true },
                        { name: 'consecutiveFailures', type: 'int', default: 0 },
                        { name: 'cooldownUntil', type: dateType, isNullable: true },
                        { name: 'lastUsedAt', type: dateType, isNullable: true },
                        { name: 'archivedAt', type: dateType, isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_image_prompt_model_config_code',
                            columnNames: ['code'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_image_prompt_model_config_priority',
                            columnNames: ['enabled', 'priority'],
                        },
                    ],
                }),
            );
        }
        const promptModelTable = await queryRunner.getTable(PROMPT_MODEL_TABLE);
        if (
            promptModelTable &&
            !promptModelTable.indices.some(index => index.name === 'IDX_image_prompt_model_config_code')
        ) {
            await queryRunner.createIndex(
                promptModelTable,
                new TableIndex({
                    name: 'IDX_image_prompt_model_config_code',
                    columnNames: ['code'],
                    isUnique: true,
                }),
            );
        }
        if (
            promptModelTable &&
            !promptModelTable.indices.some(index => index.name === 'IDX_image_prompt_model_config_priority')
        ) {
            await queryRunner.createIndex(
                promptModelTable,
                new TableIndex({
                    name: 'IDX_image_prompt_model_config_priority',
                    columnNames: ['enabled', 'priority'],
                }),
            );
        }

        await this.backfillLegacyPromptModels(queryRunner);
    }

    public async down(): Promise<void> {
        // Forward-only compatibility migration: keep copied credentials and legacy routing data available.
    }

    private async backfillLegacyPromptModels(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('image_provider_credential'))) {
            throw new Error('Cannot backfill prompt models: image_provider_credential is missing');
        }
        if (!(await queryRunner.hasTable('image_prompt_routing_config'))) {
            throw new Error('Cannot backfill prompt models: image_prompt_routing_config is missing');
        }

        const routingRows = await this.selectRows<LegacyPromptRouting>(
            queryRunner,
            'image_prompt_routing_config',
            [
                'singletonKey',
                'strategy',
                'primaryCredentialCode',
                'primaryModelId',
                'fallbackEnabled',
                'fallbackCredentialCode',
                'fallbackModelId',
            ],
        );
        const globalRouting = routingRows.filter(row => row.singletonKey === 'GLOBAL');
        if (globalRouting.length !== 1) {
            throw new Error(
                `Cannot backfill prompt models: expected one GLOBAL routing row, found ${globalRouting.length}`,
            );
        }

        const credentials = await this.selectRows<LegacyProviderCredential>(
            queryRunner,
            'image_provider_credential',
            [
                'id',
                'scope',
                'code',
                'name',
                'purpose',
                'enabled',
                'baseUrl',
                'encryptedApiKey',
                'apiKeyLast4',
                'textModelId',
                'priority',
                'weight',
                'currentWeight',
                'healthStatus',
                'healthMessage',
                'lastTestedAt',
                'consecutiveFailures',
                'cooldownUntil',
                'lastUsedAt',
                'archivedAt',
            ],
        );
        const routing = globalRouting[0];
        const seeds = this.promptModelSeeds(routing, credentials);
        const existingRows = await this.selectRows<{ code: string }>(queryRunner, PROMPT_MODEL_TABLE, [
            'code',
        ]);
        const existingCodes = new Set(existingRows.map(row => row.code));

        for (const seed of seeds) {
            if (existingCodes.has(seed.code)) continue;
            await queryRunner.manager.insert(PROMPT_MODEL_TABLE, seed);
            existingCodes.add(seed.code);
        }
    }

    private promptModelSeeds(
        routing: LegacyPromptRouting,
        credentials: LegacyProviderCredential[],
    ): PromptModelSeed[] {
        const activeCredentials = credentials.filter(credential => credential.archivedAt == null);
        if (routing.strategy === 'AUTO') {
            return activeCredentials
                .filter(
                    credential =>
                        ['PROMPT', 'BOTH'].includes(credential.purpose) && credential.textModelId.trim(),
                )
                .map(credential =>
                    this.promptModelSeed(credential, credential.textModelId, credential.priority),
                );
        }
        if (routing.strategy !== 'FIXED') {
            throw new Error(
                `Cannot backfill prompt models: unsupported routing strategy ${routing.strategy}`,
            );
        }

        const primary = this.requireFixedCredential(
            activeCredentials,
            routing.primaryCredentialCode,
            routing.primaryModelId,
            'primary',
        );
        const seeds = [this.promptModelSeed(primary.credential, primary.modelId, 0)];
        if (enabled(routing.fallbackEnabled)) {
            const fallback = this.requireFixedCredential(
                activeCredentials,
                routing.fallbackCredentialCode,
                routing.fallbackModelId,
                'fallback',
            );
            if (fallback.credential.code === primary.credential.code) {
                throw new Error(
                    'Cannot backfill prompt models: fixed primary and fallback use the same credential',
                );
            }
            seeds.push(this.promptModelSeed(fallback.credential, fallback.modelId, 10));
        }
        return seeds;
    }

    private requireFixedCredential(
        credentials: LegacyProviderCredential[],
        credentialCode: string | null,
        modelId: string | null,
        role: 'primary' | 'fallback',
    ): { credential: LegacyProviderCredential; modelId: string } {
        const code = credentialCode?.trim();
        const normalizedModelId = modelId?.trim();
        if (!code || !normalizedModelId) {
            throw new Error(`Cannot backfill prompt models: fixed ${role} route is incomplete`);
        }
        const matches = credentials.filter(credential => credential.code === code);
        if (matches.length !== 1) {
            throw new Error(
                `Cannot backfill prompt models: fixed ${role} route ${code} maps to ${matches.length} credentials`,
            );
        }
        if (!['PROMPT', 'BOTH'].includes(matches[0].purpose)) {
            throw new Error(
                `Cannot backfill prompt models: fixed ${role} route ${code} is not prompt-capable`,
            );
        }
        return { credential: matches[0], modelId: normalizedModelId };
    }

    private promptModelSeed(
        credential: LegacyProviderCredential,
        modelId: string,
        priority: number,
    ): PromptModelSeed {
        return {
            code: credential.code,
            name: credential.name || credential.code,
            enabled: enabled(credential.enabled),
            baseUrl: credential.baseUrl,
            // Copy the encrypted value byte-for-byte. Migrations must never decrypt or log provider secrets.
            encryptedApiKey: credential.encryptedApiKey,
            apiKeyLast4: credential.apiKeyLast4,
            modelId: modelId.trim(),
            apiFormat: promptApiFormat(credential.scope, modelId),
            priority,
            weight: Math.max(1, Number(credential.weight) || 1),
            currentWeight: Number(credential.currentWeight) || 0,
            healthStatus: credential.healthStatus || 'UNTESTED',
            healthMessage: credential.healthMessage,
            lastTestedAt: credential.lastTestedAt,
            consecutiveFailures: Number(credential.consecutiveFailures) || 0,
            cooldownUntil: credential.cooldownUntil,
            lastUsedAt: credential.lastUsedAt,
            archivedAt: null,
        };
    }

    private async selectRows<T>(queryRunner: QueryRunner, table: string, columns: string[]): Promise<T[]> {
        const escape = (value: string) => queryRunner.connection.driver.escape(value);
        const projection = columns.map(column => `${escape(column)} AS ${escape(column)}`).join(', ');
        return queryRunner.query(`SELECT ${projection} FROM ${escape(table)}`) as Promise<T[]>;
    }
}

function enabled(value: boolean | number | string): boolean {
    return value === true || value === 1 || value === '1';
}

function promptApiFormat(scope: string, modelId: string): 'OPENAI' | 'GEMINI' {
    return scope.toUpperCase() === 'GEMINI' || /^(?:models\/)?gemini-/iu.test(modelId.trim())
        ? 'GEMINI'
        : 'OPENAI';
}
