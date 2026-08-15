import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddStoreProfiles1786765800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('store_profile')) {
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
        const integerType: TableColumnOptions['type'] = isMysql ? 'int' : 'integer';
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
                name: 'store_profile',
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
                    { name: 'status', type: 'varchar', length: '20', default: "'DRAFT'" },
                    { name: 'isPublished', type: booleanType, default: booleanFalse },
                    { name: 'sortOrder', type: integerType, default: 0 },
                    { name: 'descriptionZh', type: 'text' },
                    { name: 'descriptionEn', type: 'text' },
                    { name: 'logoAssetId', type: idType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_store_profile_channel',
                        columnNames: ['channelId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_store_profile_public_order',
                        columnNames: ['status', 'isPublished', 'sortOrder'],
                    },
                    { name: 'IDX_store_profile_logo_asset', columnNames: ['logoAssetId'] },
                ],
                foreignKeys: [
                    {
                        name: 'FK_store_profile_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_store_profile_logo_asset',
                        columnNames: ['logoAssetId'],
                        referencedTableName: 'asset',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                ],
            }),
            true,
        );

        const quote = isMysql ? '`' : '"';
        const identifier = (value: string) => `${quote}${value}${quote}`;
        const channels = (await queryRunner.query(
            `SELECT ${identifier('id')} FROM ${identifier('channel')} ORDER BY ${identifier('id')} ASC`,
        )) as Array<{ id: string | number }>;
        if (channels.length > 0) {
            await queryRunner.manager
                .createQueryBuilder()
                .insert()
                .into('store_profile')
                .values(
                    channels.map((channel, index) => ({
                        channelId: channel.id,
                        status: 'DRAFT',
                        isPublished: false,
                        sortOrder: index,
                        descriptionZh: '',
                        descriptionEn: '',
                        logoAssetId: null,
                    })),
                )
                .execute();
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('store_profile', true);
    }
}
