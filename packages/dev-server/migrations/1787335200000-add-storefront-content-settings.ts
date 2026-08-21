import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddStorefrontContentSettings1787335200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_content_settings')) {
            return;
        }

        const databaseType = queryRunner.connection.options.type;
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const now = isMysql
            ? 'CURRENT_TIMESTAMP(6)'
            : databaseType === 'sqlite' || databaseType === 'better-sqlite3'
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });

        await queryRunner.createTable(
            new Table({
                name: 'storefront_content_settings',
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
                    { name: 'heroAutoplayIntervalSeconds', type: 'int', default: 5 },
                    { name: 'channelId', type: idType },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_content_settings_channel',
                        columnNames: ['channelId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_storefront_content_settings_channel',
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
        if (await queryRunner.hasTable('storefront_content_settings')) {
            await queryRunner.dropTable('storefront_content_settings', true);
        }
    }
}
