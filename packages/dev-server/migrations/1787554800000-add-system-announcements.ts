import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddSystemAnnouncements1787554800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('system_announcement')) return;

        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql
            ? 'CURRENT_TIMESTAMP(6)'
            : databaseType === 'sqlite' || databaseType === 'better-sqlite3'
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanTrue = databaseType === 'postgres' ? true : 1;
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        const optionalDateColumn = (name: 'startsAt' | 'endsAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            isNullable: true,
        });

        await queryRunner.createTable(
            new Table({
                name: 'system_announcement',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    timestampColumn('createdAt'),
                    timestampColumn('updatedAt'),
                    { name: 'enabled', type: booleanType, default: booleanTrue },
                    { name: 'priority', type: 'int', default: 0 },
                    { name: 'titleZh', type: 'varchar', length: '120' },
                    { name: 'titleEn', type: 'varchar', length: '120', default: "''" },
                    { name: 'contentZh', type: 'text' },
                    { name: 'contentEn', type: 'text' },
                    { name: 'linkUrl', type: 'varchar', length: '500', isNullable: true },
                    optionalDateColumn('startsAt'),
                    optionalDateColumn('endsAt'),
                ],
                indices: [
                    {
                        name: 'IDX_system_announcement_schedule',
                        columnNames: ['enabled', 'startsAt', 'endsAt', 'priority'],
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('system_announcement')) {
            await queryRunner.dropTable('system_announcement', true);
        }
    }
}
