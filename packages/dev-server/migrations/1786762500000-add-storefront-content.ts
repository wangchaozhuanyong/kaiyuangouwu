import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddStorefrontContent1786762500000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType = databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now =
            databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? "datetime('now')"
                : 'CURRENT_TIMESTAMP';
        const booleanTrue = databaseType === 'postgres' ? true : 1;

        if (!(await queryRunner.hasTable('storefront_content_block'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_content_block',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        { name: 'createdAt', type: dateType, default: now },
                        { name: 'updatedAt', type: dateType, default: now },
                        { name: 'code', type: 'varchar', length: '64' },
                        { name: 'type', type: 'varchar', length: '32' },
                        { name: 'enabled', type: 'boolean', default: booleanTrue },
                        { name: 'position', type: 'int', default: 0 },
                        { name: 'startsAt', type: dateType, isNullable: true },
                        { name: 'endsAt', type: dateType, isNullable: true },
                        { name: 'imageUrl', type: 'varchar', length: '2048', isNullable: true },
                        { name: 'backgroundColor', type: 'varchar', length: '32', isNullable: true },
                        { name: 'textColor', type: 'varchar', length: '32', isNullable: true },
                        { name: 'targetType', type: 'varchar', length: '32', default: "'NONE'" },
                        { name: 'targetValue', type: 'varchar', length: '2048', isNullable: true },
                        { name: 'channelId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_storefront_content_block_channel_code',
                            columnNames: ['channelId', 'code'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_storefront_content_block_channel_position',
                            columnNames: ['channelId', 'position'],
                        },
                        {
                            name: 'IDX_storefront_content_block_channel',
                            columnNames: ['channelId'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_content_block_channel',
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

        if (!(await queryRunner.hasTable('storefront_content_block_translation'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_content_block_translation',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        { name: 'createdAt', type: dateType, default: now },
                        { name: 'updatedAt', type: dateType, default: now },
                        { name: 'languageCode', type: 'varchar', length: '16' },
                        { name: 'title', type: 'varchar', length: '255', default: "''" },
                        { name: 'subtitle', type: 'varchar', length: '500', default: "''" },
                        { name: 'body', type: 'text', default: "''" },
                        { name: 'ctaLabel', type: 'varchar', length: '120', default: "''" },
                        { name: 'baseId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_storefront_content_block_translation_language',
                            columnNames: ['baseId', 'languageCode'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_content_block_translation_base',
                            columnNames: ['baseId'],
                            referencedTableName: 'storefront_content_block',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('storefront_content_item'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_content_item',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        { name: 'createdAt', type: dateType, default: now },
                        { name: 'updatedAt', type: dateType, default: now },
                        { name: 'enabled', type: 'boolean', default: booleanTrue },
                        { name: 'position', type: 'int', default: 0 },
                        { name: 'imageUrl', type: 'varchar', length: '2048', isNullable: true },
                        { name: 'targetType', type: 'varchar', length: '32', default: "'NONE'" },
                        { name: 'targetValue', type: 'varchar', length: '2048', isNullable: true },
                        { name: 'blockId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_storefront_content_item_block_position',
                            columnNames: ['blockId', 'position'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_content_item_block',
                            columnNames: ['blockId'],
                            referencedTableName: 'storefront_content_block',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('storefront_content_item_translation'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'storefront_content_item_translation',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        { name: 'createdAt', type: dateType, default: now },
                        { name: 'updatedAt', type: dateType, default: now },
                        { name: 'languageCode', type: 'varchar', length: '16' },
                        { name: 'label', type: 'varchar', length: '255', default: "''" },
                        { name: 'description', type: 'text', default: "''" },
                        { name: 'baseId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_storefront_content_item_translation_language',
                            columnNames: ['baseId', 'languageCode'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_storefront_content_item_translation_base',
                            columnNames: ['baseId'],
                            referencedTableName: 'storefront_content_item',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of [
            'storefront_content_item_translation',
            'storefront_content_item',
            'storefront_content_block_translation',
            'storefront_content_block',
        ]) {
            if (await queryRunner.hasTable(tableName)) {
                await queryRunner.dropTable(tableName, true);
            }
        }
    }
}
