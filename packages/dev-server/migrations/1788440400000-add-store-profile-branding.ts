import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

const TABLE_NAME = 'store_profile';

export class AddStoreProfileBranding1788440400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(TABLE_NAME))) return;

        const databaseType = queryRunner.connection.options.type;
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const columns = [
            new TableColumn({ name: 'logoOnLightAssetId', type: idType, isNullable: true }),
            new TableColumn({ name: 'logoOnDarkAssetId', type: idType, isNullable: true }),
            new TableColumn({ name: 'taglineZh', type: 'varchar', length: '160', isNullable: true }),
            new TableColumn({ name: 'taglineEn', type: 'varchar', length: '160', isNullable: true }),
            new TableColumn({
                name: 'brandBackgroundColor',
                type: 'varchar',
                length: '7',
                isNullable: true,
            }),
            new TableColumn({ name: 'brandPrimaryColor', type: 'varchar', length: '7', isNullable: true }),
            new TableColumn({ name: 'brandAccentColor', type: 'varchar', length: '7', isNullable: true }),
            new TableColumn({
                name: 'brandHighlightColor',
                type: 'varchar',
                length: '7',
                isNullable: true,
            }),
        ];

        for (const column of columns) {
            if (!(await queryRunner.hasColumn(TABLE_NAME, column.name))) {
                await queryRunner.addColumn(TABLE_NAME, column);
            }
        }

        await this.ensureAssetRelation(
            queryRunner,
            'logoOnLightAssetId',
            'IDX_store_profile_logo_on_light_asset',
            'FK_store_profile_logo_on_light_asset',
        );
        await this.ensureAssetRelation(
            queryRunner,
            'logoOnDarkAssetId',
            'IDX_store_profile_logo_on_dark_asset',
            'FK_store_profile_logo_on_dark_asset',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(TABLE_NAME))) return;
        const table = await queryRunner.getTable(TABLE_NAME);
        if (!table) return;

        for (const foreignKeyName of [
            'FK_store_profile_logo_on_light_asset',
            'FK_store_profile_logo_on_dark_asset',
        ]) {
            const foreignKey = table.foreignKeys.find(candidate => candidate.name === foreignKeyName);
            if (foreignKey) await queryRunner.dropForeignKey(TABLE_NAME, foreignKey);
        }
        for (const indexName of [
            'IDX_store_profile_logo_on_light_asset',
            'IDX_store_profile_logo_on_dark_asset',
        ]) {
            const index = table.indices.find(candidate => candidate.name === indexName);
            if (index) await queryRunner.dropIndex(TABLE_NAME, index);
        }
        for (const columnName of [
            'brandHighlightColor',
            'brandAccentColor',
            'brandPrimaryColor',
            'brandBackgroundColor',
            'taglineEn',
            'taglineZh',
            'logoOnDarkAssetId',
            'logoOnLightAssetId',
        ]) {
            if (await queryRunner.hasColumn(TABLE_NAME, columnName)) {
                await queryRunner.dropColumn(TABLE_NAME, columnName);
            }
        }
    }

    private async ensureAssetRelation(
        queryRunner: QueryRunner,
        columnName: string,
        indexName: string,
        foreignKeyName: string,
    ): Promise<void> {
        let table = await queryRunner.getTable(TABLE_NAME);
        if (!table) return;
        if (!table.indices.some(index => index.name === indexName)) {
            await queryRunner.createIndex(
                TABLE_NAME,
                new TableIndex({ name: indexName, columnNames: [columnName] }),
            );
        }
        table = await queryRunner.getTable(TABLE_NAME);
        if (!table?.foreignKeys.some(foreignKey => foreignKey.name === foreignKeyName)) {
            await queryRunner.createForeignKey(
                TABLE_NAME,
                new TableForeignKey({
                    name: foreignKeyName,
                    columnNames: [columnName],
                    referencedTableName: 'asset',
                    referencedColumnNames: ['id'],
                    onDelete: 'SET NULL',
                }),
            );
        }
    }
}
