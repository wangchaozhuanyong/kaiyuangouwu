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
        const columnNames = [
            'channelId',
            'status',
            'isPublished',
            'sortOrder',
            'descriptionZh',
            'descriptionEn',
            'logoAssetId',
        ];
        for (const [index, channel] of channels.entries()) {
            const placeholders = columnNames.map((_, parameterIndex) =>
                databaseType === 'postgres' || databaseType === 'cockroachdb'
                    ? `$${parameterIndex + 1}`
                    : '?',
            );
            // Use raw SQL instead of the current StoreProfile entity metadata. Newer entity
            // fields are introduced by later migrations and must not leak into this historical
            // insert when bootstrapping a clean database.
            await queryRunner.query(
                `INSERT INTO ${identifier('store_profile')} (${columnNames
                    .map(identifier)
                    .join(', ')}) VALUES (${placeholders.join(', ')})`,
                [channel.id, 'DRAFT', booleanFalse, index, '', '', null],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('store_profile', true);
    }
}
