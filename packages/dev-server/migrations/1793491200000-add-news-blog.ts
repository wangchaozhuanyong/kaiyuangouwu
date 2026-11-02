import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';
const definitions = {
    tables: {
        news_blog_settings: [
            ['version', 'int', 1],
            ['enabled', 'boolean', false],
            ['automationEnabled', 'boolean', false],
            ['intervalMinutes', 'int', 30],
            ['dailyMaxArticles', 'int', 3],
            ['settingsJson', 'text'],
            ['lastCollectedAt', 'date', null],
            ['leaseUntil', 'date', null],
        ],
        news_blog_article: [
            ['slug', 'varchar', 100],
            ['eventKey', 'varchar', 64, null],
            ['version', 'int', 1],
            ['state', 'varchar', 24, 'DRAFT'],
            ['draftJson', 'text'],
            ['publishedJson', 'text', null],
            ['publishedAt', 'date', null],
            ['issuesJson', 'text'],
            ['publishedTitle', 'varchar', 160, ''],
            ['publishedCategory', 'varchar', 24, ''],
            ['publishedSearchText', 'text', null],
            ['publishedPinned', 'boolean', false],
        ],
        news_blog_revision: [
            ['articleId', 'id'],
            ['version', 'int'],
            ['action', 'varchar', 24],
            ['actorId', 'varchar', 128],
            ['snapshotJson', 'text', null],
        ],
        news_blog_source: [
            ['code', 'varchar', 40],
            ['enabled', 'boolean', true],
            ['version', 'int', 1],
            ['lastCollectedAt', 'date', null],
            ['status', 'varchar', 40, 'NOT_COLLECTED'],
            ['message', 'varchar', 300, ''],
            ['etag', 'varchar', 512, null],
            ['lastModified', 'varchar', 128, null],
        ],
        news_blog_source_item: [
            ['sourceCode', 'varchar', 40],
            ['identityKey', 'varchar', 64],
            ['contentHash', 'varchar', 64],
            ['eventKey', 'varchar', 64],
            ['url', 'varchar', 2048],
            ['title', 'varchar', 500],
            ['category', 'varchar', 24],
            ['body', 'text'],
            ['sourcePublishedAt', 'date'],
            ['fetchedAt', 'date'],
            ['status', 'varchar', 24, 'READY'],
        ],
        news_blog_run: [
            ['requestKey', 'varchar', 160],
            ['kind', 'varchar', 24],
            ['state', 'varchar', 24, 'QUEUED'],
            ['budgetDate', 'varchar', 10],
            ['reservedMicros', 'int', 0],
            ['chargedMicros', 'int', 0],
            ['inputJson', 'text'],
            ['telemetryJson', 'text', null],
            ['message', 'varchar', 500, ''],
            ['startedAt', 'date', null],
            ['completedAt', 'date', null],
        ],
    },
    indices: {
        news_blog_settings: [['UQ_news_blog_settings_channel', ['channelId'], true]],
        news_blog_article: [
            ['UQ_news_blog_article_slug', ['channelId', 'slug'], true],
            ['UQ_news_blog_article_event', ['channelId', 'eventKey'], true],
            ['IDX_news_blog_published', ['channelId', 'publishedAt'], false],
        ],
        news_blog_revision: [['UQ_news_blog_revision', ['channelId', 'articleId', 'version'], true]],
        news_blog_source: [['UQ_news_blog_source', ['channelId', 'code'], true]],
        news_blog_source_item: [
            ['UQ_news_blog_source_item', ['channelId', 'identityKey'], true],
            ['IDX_news_blog_source_event', ['channelId', 'eventKey'], false],
        ],
        news_blog_run: [
            ['UQ_news_blog_run_key', ['channelId', 'requestKey'], true],
            ['IDX_news_blog_run_budget', ['channelId', 'budgetDate'], false],
        ],
    },
};
/** Additive migration only; never deletes or rewrites existing business data. */
export class AddNewsBlog1793491200000 implements MigrationInterface {
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
                { name: 'channelId', type: idType },
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
                    foreignKeys: [
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
                    ],
                }),
                true,
            );
        }
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error(
                'Retain news blog articles, revisions, source evidence and operating cost records; use a reviewed forward migration.',
            ),
        );
    }
}
