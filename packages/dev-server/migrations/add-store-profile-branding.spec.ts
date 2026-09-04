import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddStoreProfileBranding1788440400000 } from './1788440400000-add-store-profile-branding';

describe('store profile branding migration', () => {
    it('adds reversible, idempotent channel branding columns and asset relations', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await createLegacyTables(queryRunner);
            const migration = new AddStoreProfileBranding1788440400000();

            await migration.up(queryRunner);
            await migration.up(queryRunner);

            const table = await queryRunner.getTable('store_profile');
            expect(table?.columns.map(column => column.name)).toEqual(
                expect.arrayContaining([
                    'logoOnLightAssetId',
                    'logoOnDarkAssetId',
                    'taglineZh',
                    'taglineEn',
                    'brandBackgroundColor',
                    'brandPrimaryColor',
                    'brandAccentColor',
                    'brandHighlightColor',
                ]),
            );
            expect(table?.indices.map(index => index.name)).toEqual(
                expect.arrayContaining([
                    'IDX_store_profile_logo_on_light_asset',
                    'IDX_store_profile_logo_on_dark_asset',
                ]),
            );
            expect(table?.foreignKeys.map(foreignKey => foreignKey.name)).toEqual(
                expect.arrayContaining([
                    'FK_store_profile_logo_on_light_asset',
                    'FK_store_profile_logo_on_dark_asset',
                ]),
            );

            await migration.down(queryRunner);

            expect(await queryRunner.hasColumn('store_profile', 'taglineZh')).toBe(false);
            expect(await queryRunner.hasColumn('store_profile', 'logoOnLightAssetId')).toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});

async function createLegacyTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
        new Table({
            name: 'asset',
            columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
        }),
    );
    await queryRunner.createTable(
        new Table({
            name: 'store_profile',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                { name: 'channelId', type: 'integer' },
                { name: 'descriptionZh', type: 'text' },
                { name: 'descriptionEn', type: 'text' },
            ],
        }),
    );
}
