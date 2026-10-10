import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

/** Additive only: no existing store state, product facts, permissions or credentials are changed. */
export class AddStorefrontSeo1791580800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const type = queryRunner.connection.options.type;
        const mysql = type === 'mysql' || type === 'mariadb';
        const sqlite = type === 'sqlite' || type === 'better-sqlite3';
        const idType = type === 'postgres' || sqlite ? 'integer' : 'int';
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const date = (name: string, nullable = false): TableColumnOptions => ({
            name,
            type: dateType,
            ...(mysql ? { precision: 6 } : {}),
            isNullable: nullable,
        });
        const base: TableColumnOptions[] = [
            { name: 'id', type: idType, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
            { ...date('createdAt'), default: now },
            { ...date('updatedAt'), default: now, ...(mysql ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}) },
            { name: 'channelId', type: idType },
        ];
        if (!(await queryRunner.hasTable('storefront_seo_record'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_seo_record',
                    columns: [
                        ...base,
                        { name: 'targetType', type: 'varchar', length: '16' },
                        { name: 'targetId', type: 'varchar', length: '160' },
                        { name: 'languageCode', type: 'varchar', length: '16' },
                        { name: 'draftJson', type: 'text' },
                        { name: 'publishedJson', type: 'text', isNullable: true },
                        { name: 'version', type: 'int', default: 1 },
                        { name: 'publishedVersion', type: 'int', default: 0 },
                        date('publishedAt', true),
                        { name: 'publishedByUserId', type: 'varchar', length: '128', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'UQ_storefront_seo_identity',
                            columnNames: ['channelId', 'targetType', 'targetId', 'languageCode'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_seo_channel',
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
        if (!(await queryRunner.hasTable('storefront_seo_revision'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_seo_revision',
                    columns: [
                        ...base,
                        { name: 'recordId', type: idType },
                        { name: 'version', type: 'int' },
                        { name: 'payloadJson', type: 'text', isNullable: true },
                        date('publishedAt'),
                        { name: 'publishedBy', type: 'varchar', length: '128' },
                    ],
                    indices: [
                        {
                            name: 'UQ_storefront_seo_revision',
                            columnNames: ['recordId', 'version'],
                            isUnique: true,
                        },
                        { name: 'IDX_storefront_seo_revision_channel', columnNames: ['channelId'] },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_seo_revision_record',
                            columnNames: ['recordId'],
                            referencedTableName: 'storefront_seo_record',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_storefront_seo_revision_channel',
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
        // Published history is user data. A runtime rollback must not silently destroy it.
        return Promise.reject(
            new Error(
                'SEO publication data is retained; removing these tables requires a separately reviewed data migration.',
            ),
        );
    }
}
