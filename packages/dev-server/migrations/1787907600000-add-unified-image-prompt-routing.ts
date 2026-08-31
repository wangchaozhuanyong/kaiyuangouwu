import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

export class AddUnifiedImagePromptRouting1787907600000 implements MigrationInterface {
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

        if (!(await queryRunner.hasColumn('image_provider_credential', 'orchestrationModelId'))) {
            await queryRunner.addColumn(
                'image_provider_credential',
                new TableColumn({
                    name: 'orchestrationModelId',
                    type: 'varchar',
                    length: '160',
                    default: "''",
                }),
            );
            await queryRunner.manager
                .createQueryBuilder()
                .update('image_provider_credential')
                .set({
                    orchestrationModelId: () => queryRunner.connection.driver.escape('textModelId'),
                })
                .where('scope = :scope', { scope: 'OPENAI' })
                .execute();
        }

        if (!(await queryRunner.hasTable('image_prompt_routing_config'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'image_prompt_routing_config',
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
                        { name: 'singletonKey', type: 'varchar', length: '16', default: "'GLOBAL'" },
                        { name: 'strategy', type: 'varchar', length: '16', default: "'AUTO'" },
                        { name: 'primaryCredentialCode', type: 'varchar', length: '64', isNullable: true },
                        { name: 'primaryModelId', type: 'varchar', length: '160', isNullable: true },
                        { name: 'fallbackEnabled', type: booleanType, default: booleanFalse },
                        { name: 'fallbackCredentialCode', type: 'varchar', length: '64', isNullable: true },
                        { name: 'fallbackModelId', type: 'varchar', length: '160', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_image_prompt_routing_config_singleton',
                            columnNames: ['singletonKey'],
                            isUnique: true,
                        },
                    ],
                }),
            );
        }

        const existing = await queryRunner.manager
            .createQueryBuilder()
            .select('routing.id')
            .from('image_prompt_routing_config', 'routing')
            .where('routing.singletonKey = :singletonKey', { singletonKey: 'GLOBAL' })
            .getRawOne();
        if (!existing) {
            await queryRunner.manager
                .createQueryBuilder()
                .insert()
                .into('image_prompt_routing_config')
                .values({ singletonKey: 'GLOBAL', strategy: 'AUTO', fallbackEnabled: false })
                .execute();
        }
    }

    public async down(): Promise<void> {
        // Forward-only production migration: routing history and compatibility data are retained.
    }
}
