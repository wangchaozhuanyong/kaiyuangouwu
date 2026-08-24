import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class UpgradeStorefrontContentEditor1787551200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';

        const block = await queryRunner.getTable('storefront_content_block');
        if (block) {
            if (!block.findColumnByName('internalName')) {
                await queryRunner.addColumn(
                    block,
                    new TableColumn({
                        name: 'internalName',
                        type: 'varchar',
                        length: '128',
                        isNullable: false,
                        default: "''",
                    }),
                );
            }
            if (!block.findColumnByName('layoutVariant')) {
                await queryRunner.addColumn(
                    block,
                    new TableColumn({
                        name: 'layoutVariant',
                        type: 'varchar',
                        length: '32',
                        isNullable: false,
                        default: "'AUTO'",
                    }),
                );
            }
            if (!block.findColumnByName('settings')) {
                await queryRunner.addColumn(
                    block,
                    new TableColumn({ name: 'settings', type: 'text', isNullable: true }),
                );
            }
            if (!block.findColumnByName('imageAssetId')) {
                await queryRunner.addColumn(
                    block,
                    new TableColumn({ name: 'imageAssetId', type: idType, isNullable: true }),
                );
            }
            await this.backfillInternalNames(queryRunner);
            await this.ensureAssetRelation(
                queryRunner,
                'storefront_content_block',
                'IDX_storefront_content_block_image_asset',
                'FK_storefront_content_block_image_asset',
            );
        }

        const item = await queryRunner.getTable('storefront_content_item');
        if (item) {
            if (!item.findColumnByName('settings')) {
                await queryRunner.addColumn(
                    item,
                    new TableColumn({ name: 'settings', type: 'text', isNullable: true }),
                );
            }
            if (!item.findColumnByName('imageAssetId')) {
                await queryRunner.addColumn(
                    item,
                    new TableColumn({ name: 'imageAssetId', type: idType, isNullable: true }),
                );
            }
            await this.ensureAssetRelation(
                queryRunner,
                'storefront_content_item',
                'IDX_storefront_content_item_image_asset',
                'FK_storefront_content_item_image_asset',
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.dropAssetRelation(
            queryRunner,
            'storefront_content_item',
            'IDX_storefront_content_item_image_asset',
            'FK_storefront_content_item_image_asset',
        );
        await this.dropColumns(queryRunner, 'storefront_content_item', ['settings', 'imageAssetId']);

        await this.dropAssetRelation(
            queryRunner,
            'storefront_content_block',
            'IDX_storefront_content_block_image_asset',
            'FK_storefront_content_block_image_asset',
        );
        await this.dropColumns(queryRunner, 'storefront_content_block', [
            'settings',
            'imageAssetId',
            'layoutVariant',
            'internalName',
        ]);
    }

    private async backfillInternalNames(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        if (databaseType === 'mysql' || databaseType === 'mariadb') {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
        await queryRunner.query(
            `UPDATE "storefront_content_block" SET "internalName" = "code" ` +
                `WHERE "internalName" IS NULL OR "internalName" = ''`,
        );
    }

    private async ensureAssetRelation(
        queryRunner: QueryRunner,
        tableName: string,
        indexName: string,
        foreignKeyName: string,
    ): Promise<void> {
        const [table, assetTable] = await Promise.all([
            queryRunner.getTable(tableName),
            queryRunner.getTable('asset'),
        ]);
        if (!table?.findColumnByName('imageAssetId')) {
            return;
        }
        if (!table.indices.some(index => index.name === indexName)) {
            await queryRunner.createIndex(
                table,
                new TableIndex({ name: indexName, columnNames: ['imageAssetId'] }),
            );
        }
        if (assetTable && !table.foreignKeys.some(foreignKey => foreignKey.name === foreignKeyName)) {
            await queryRunner.createForeignKey(
                table,
                new TableForeignKey({
                    name: foreignKeyName,
                    columnNames: ['imageAssetId'],
                    referencedTableName: 'asset',
                    referencedColumnNames: ['id'],
                    onDelete: 'SET NULL',
                }),
            );
        }
    }

    private async dropAssetRelation(
        queryRunner: QueryRunner,
        tableName: string,
        indexName: string,
        foreignKeyName: string,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (!table) {
            return;
        }
        const foreignKey = table.foreignKeys.find(candidate => candidate.name === foreignKeyName);
        if (foreignKey) {
            await queryRunner.dropForeignKey(table, foreignKey);
        }
        const index = table.indices.find(candidate => candidate.name === indexName);
        if (index) {
            await queryRunner.dropIndex(table, index);
        }
    }

    private async dropColumns(
        queryRunner: QueryRunner,
        tableName: string,
        columnNames: string[],
    ): Promise<void> {
        for (const columnName of columnNames) {
            const table = await queryRunner.getTable(tableName);
            if (table?.findColumnByName(columnName)) {
                await queryRunner.dropColumn(table, columnName);
            }
        }
    }
}
