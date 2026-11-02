import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';
const definitions = {
    tables: {
        news_blog_skill: [
            ['identity', 'varchar', 64],
            ['repositoryId', 'varchar', 40],
            ['repository', 'varchar', 300],
            ['directory', 'varchar', 1000],
            ['name', 'varchar', 100],
            ['contentHash', 'varchar', 64],
            ['body', 'text'],
            ['evidenceJson', 'text'],
            ['status', 'varchar', 24, 'READY'],
            ['message', 'varchar', 300, ''],
            ['checkedAt', 'date'],
        ],
        news_blog_skill_observation: [
            ['identity', 'varchar', 64],
            ['stars', 'int'],
            ['rankingJson', 'text'],
            ['observedAt', 'date'],
        ],
        news_blog_skill_state: [
            ['code', 'varchar', 32],
            ['leaseUntil', 'date', null],
            ['lastCollectedAt', 'date', null],
            ['requestWindow', 'date', null],
            ['requestCount', 'int', 0],
            ['message', 'varchar', 300, ''],
        ],
        news_blog_skill_recommendation: [
            ['day', 'varchar', 10],
            ['identity', 'varchar', 64],
            ['repositoryId', 'varchar', 40],
            ['status', 'varchar', 24, 'SELECTED'],
            ['message', 'varchar', 300, ''],
            ['articleId', 'varchar', 40, null],
            ['contentHash', 'varchar', 64],
            ['evidenceJson', 'text'],
        ],
    },
    indices: {
        news_blog_skill: [['UQ_blog_skill_identity', ['identity'], true]],
        news_blog_skill_observation: [['IDX_blog_skill_observed', ['identity', 'observedAt'], false]],
        news_blog_skill_state: [['UQ_blog_skill_state', ['code'], true]],
        news_blog_skill_recommendation: [
            ['UQ_blog_skill_day', ['channelId', 'day'], true],
            ['UQ_blog_skill_once', ['channelId', 'identity'], true],
        ],
    },
};
/** Additive migration only; never deletes or rewrites existing business data. */
export class AddBlogSkills1793577600000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const type = runner.connection.options.type;
        const mysql = type === 'mysql' || type === 'mariadb';
        const idType =
            type === 'postgres' || ['sqlite', 'better-sqlite3', 'sqljs'].includes(type) ? 'integer' : 'int';
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = mysql
            ? 'CURRENT_TIMESTAMP(6)'
            : type === 'postgres'
              ? 'CURRENT_TIMESTAMP'
              : "datetime('now')";
        const date = (name: string, nullable = false): TableColumnOptions => ({
            name,
            type: dateType,
            isNullable: nullable,
            ...(mysql ? { precision: 6 } : {}),
        });
        for (const [name, values] of Object.entries(definitions.tables)) {
            if (await runner.hasTable(name)) continue;
            const columns: TableColumnOptions[] = [
                {
                    name: 'id',
                    type: idType,
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: 'increment',
                },
                { ...date('createdAt'), default: now },
                {
                    ...date('updatedAt'),
                    default: now,
                    ...(mysql ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                },
                ...(name === 'news_blog_skill_recommendation' ? [{ name: 'channelId', type: idType }] : []),
            ];
            for (const [columnName, columnType, ...rest] of values) {
                const column: TableColumnOptions = {
                    name: String(columnName),
                    type:
                        columnType === 'date' ? dateType : columnType === 'id' ? idType : String(columnType),
                };
                if (columnType === 'varchar') column.length = String(rest.shift());
                if (rest.length) {
                    if (rest[0] === null) column.isNullable = true;
                    else column.default = typeof rest[0] === 'string' ? `'${rest[0]}'` : rest[0];
                }
                if (columnType === 'date' && mysql) column.precision = 6;
                columns.push(column);
            }
            const indexes = definitions.indices[name as keyof typeof definitions.indices].map(
                ([indexName, columnNames, unique]) => ({
                    name: String(indexName),
                    columnNames: columnNames as string[],
                    isUnique: unique as boolean,
                }),
            );
            await runner.createTable(
                new Table({
                    name,
                    columns,
                    indices: indexes,
                    foreignKeys:
                        name === 'news_blog_skill_recommendation'
                            ? [
                                  {
                                      name: runner.connection.namingStrategy.foreignKeyName(
                                          name,
                                          ['channelId'],
                                          'channel',
                                          ['id'],
                                      ),
                                      columnNames: ['channelId'],
                                      referencedTableName: 'channel',
                                      referencedColumnNames: ['id'],
                                      onDelete: 'CASCADE',
                                  },
                              ]
                            : [],
                }),
                true,
            );
        }
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error(
                'Retain skill identities, recommendation history and discovery evidence; use a reviewed forward migration.',
            ),
        );
    }
}
