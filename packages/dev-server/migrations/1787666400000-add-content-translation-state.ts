import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddContentTranslationState1787666400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('content_translation_state')) return;
        await queryRunner.createTable(
            new Table({
                name: 'content_translation_state',
                columns: [
                    idColumn(queryRunner),
                    timestampColumn('createdAt', queryRunner),
                    timestampColumn('updatedAt', queryRunner),
                    { name: 'stateKey', type: 'varchar', length: '64', isNullable: false },
                    { name: 'channelId', type: 'varchar', length: '64', isNullable: true },
                    { name: 'entityType', type: 'varchar', length: '64', isNullable: false },
                    { name: 'entityId', type: 'varchar', length: '64', isNullable: false },
                    { name: 'fieldPath', type: 'varchar', length: '128', isNullable: false },
                    {
                        name: 'sourceLanguageCode',
                        type: 'varchar',
                        length: '20',
                        isNullable: false,
                        default: "'zh_Hans'",
                    },
                    {
                        name: 'targetLanguageCode',
                        type: 'varchar',
                        length: '20',
                        isNullable: false,
                        default: "'en'",
                    },
                    { name: 'sourceHash', type: 'varchar', length: '64', isNullable: false },
                    { name: 'translatedHash', type: 'varchar', length: '64', isNullable: true },
                    {
                        name: 'status',
                        type: 'varchar',
                        length: '24',
                        isNullable: false,
                        default: "'MISSING'",
                    },
                    {
                        name: 'origin',
                        type: 'varchar',
                        length: '12',
                        isNullable: false,
                        default: "'AUTO'",
                    },
                    { name: 'locked', type: booleanType(queryRunner), isNullable: false, default: false },
                    { name: 'error', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_content_translation_state_key',
                        columnNames: ['stateKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_content_translation_state_audit',
                        columnNames: ['channelId', 'entityType', 'status'],
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('content_translation_state')) {
            await queryRunner.dropTable('content_translation_state', true);
        }
    }
}

function idColumn(queryRunner: QueryRunner) {
    if (queryRunner.connection.options.type === 'postgres') {
        return { name: 'id', type: 'SERIAL', isPrimary: true, isNullable: false };
    }
    return {
        name: 'id',
        type: 'integer',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment' as const,
    };
}

function timestampColumn(name: 'createdAt' | 'updatedAt', queryRunner: QueryRunner) {
    const databaseType = queryRunner.connection.options.type;
    const isMysql = ['mysql', 'mariadb'].includes(databaseType);
    const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
    return {
        name,
        type: databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime',
        ...(isMysql ? { precision: 6 } : {}),
        isNullable: false,
        default: isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP',
        ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
    };
}

function booleanType(queryRunner: QueryRunner): string {
    return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? 'tinyint' : 'boolean';
}
