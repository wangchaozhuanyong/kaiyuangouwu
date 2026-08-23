import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddStorefrontPromotionPages1787338800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_promotion_page')) {
            return;
        }

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
        const booleanFalse = databaseType === 'postgres' ? false : 0;
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });

        await queryRunner.createTable(
            new Table({
                name: 'storefront_promotion_page',
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
                    { name: 'channelId', type: idType },
                    { name: 'contentType', type: 'varchar', length: '16', default: "'HTML'" },
                    { name: 'draftSource', type: 'text', isNullable: true },
                    { name: 'publishedContentType', type: 'varchar', length: '16', default: "'HTML'" },
                    { name: 'publishedSource', type: 'text', isNullable: true },
                    { name: 'isCustomized', type: booleanType, default: booleanFalse },
                    { name: 'defaultTemplateVersion', type: 'int', default: 1 },
                    { name: 'publishedVersion', type: 'int', default: 0 },
                    {
                        name: 'publishedAt',
                        type: dateType,
                        ...(isMysql ? { precision: 6 } : {}),
                        isNullable: true,
                    },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_promotion_page_channel',
                        columnNames: ['channelId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_storefront_promotion_page_channel',
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

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_promotion_page')) {
            await queryRunner.dropTable('storefront_promotion_page', true);
        }
    }
}
