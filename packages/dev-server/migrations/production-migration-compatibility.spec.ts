import { Permission } from '@vendure/common/lib/generated-types';
import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddStorefrontContent1786762500000 } from './1786762500000-add-storefront-content';
import { AddCustomerOrderNote1786764000000 } from './1786764000000-add-customer-order-note';
import { AddStoreProfiles1786765800000 } from './1786765800000-add-store-profiles';
import { AddStoreAdministratorAccess1786767600000 } from './1786767600000-add-store-administrator-access';
import { HardenStoreAdministratorPermissions1786769400000 } from './1786769400000-harden-store-administrator-permissions';
import { EnableMainlandChineseLanguage1786771200000 } from './1786771200000-enable-mainland-chinese-language';
import { AddAfterSalesCenter1787203000000 } from './1787203000000-add-after-sales-center';
import { AddStorefrontReviews1787204800000 } from './1787204800000-add-storefront-reviews';

function mysqlQueryRunner(existingTables: string[] = []) {
    const createdTables: Table[] = [];
    const changeColumn = vi.fn(async () => undefined);
    const queryRunner = {
        connection: { options: { type: 'mysql' } },
        hasTable: vi.fn(async (name: string) => existingTables.includes(name)),
        createTable: vi.fn(async (table: Table) => {
            createdTables.push(table);
        }),
        changeColumn,
    } as unknown as QueryRunner;

    return { changeColumn, createdTables, queryRunner };
}

describe('production migration compatibility', () => {
    it('creates portable verified review storage with one review per order line', async () => {
        const { createdTables, queryRunner } = mysqlQueryRunner();

        await new AddStorefrontReviews1787204800000().up(queryRunner);

        expect(createdTables).toHaveLength(1);
        expect(createdTables[0].name).toBe('storefront_review');
        expect(createdTables[0].findColumnByName('createdAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
        });
        expect(createdTables[0].findColumnByName('merchantResponse')).toMatchObject({
            type: 'text',
            isNullable: true,
        });
        expect(createdTables[0].indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'IDX_storefront_review_order_line',
                    isUnique: true,
                }),
            ]),
        );
    });

    it('creates portable after-sales request, item and event tables', async () => {
        const { createdTables, queryRunner } = mysqlQueryRunner();

        await new AddAfterSalesCenter1787203000000().up(queryRunner);

        expect(createdTables.map(table => table.name)).toEqual([
            'after_sales_request',
            'after_sales_item',
            'after_sales_event',
        ]);
        const columns = createdTables.flatMap(table => table.columns);
        expect(columns.find(column => column.name === 'createdAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
        });
        expect(columns.find(column => column.name === 'updatedAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            onUpdate: 'CURRENT_TIMESTAMP(6)',
        });
        expect(columns.filter(column => ['description', 'resolution', 'note'].includes(column.name))).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
        );
        expect(createdTables[0].indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'IDX_after_sales_request_code', isUnique: true }),
            ]),
        );
    });

    it('resumes the after-sales migration without recreating existing tables', async () => {
        const { createdTables, queryRunner } = mysqlQueryRunner(['after_sales_request']);

        await new AddAfterSalesCenter1787203000000().up(queryRunner);

        expect(createdTables.map(table => table.name)).toEqual(['after_sales_item', 'after_sales_event']);
    });

    it('enables simplified Chinese globally without replacing existing languages', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce([{ id: 7, availableLanguages: 'en,zh_Hant' }])
            .mockResolvedValueOnce(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            query,
        } as unknown as QueryRunner;

        await new EnableMainlandChineseLanguage1786771200000().up(queryRunner);

        expect(query).toHaveBeenNthCalledWith(1, `SELECT "id", "availableLanguages" FROM "global_settings"`);
        expect(query).toHaveBeenNthCalledWith(
            2,
            `UPDATE "global_settings" SET "availableLanguages" = $1 WHERE "id" = $2`,
            ['en,zh_Hant,zh_Hans', 7],
        );
    });

    it('does not rewrite global languages when simplified Chinese is already enabled', async () => {
        const query = vi.fn(async () => [{ id: 1, availableLanguages: 'en,zh_Hans' }]);
        const queryRunner = {
            connection: { options: { type: 'sqlite' } },
            query,
        } as unknown as QueryRunner;

        await new EnableMainlandChineseLanguage1786771200000().up(queryRunner);

        expect(query).toHaveBeenCalledOnce();
    });

    it('uses MySQL-compatible identifier quoting and parameters for the language update', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce([{ id: 3, availableLanguages: 'en' }])
            .mockResolvedValueOnce(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            query,
        } as unknown as QueryRunner;

        await new EnableMainlandChineseLanguage1786771200000().up(queryRunner);

        expect(query).toHaveBeenNthCalledWith(
            1,
            `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
        );
        expect(query).toHaveBeenNthCalledWith(2, `SELECT "id", "availableLanguages" FROM "global_settings"`);
        expect(query).toHaveBeenNthCalledWith(
            3,
            `UPDATE "global_settings" SET "availableLanguages" = ? WHERE "id" = ?`,
            ['en,zh_Hans', 3],
        );
    });

    it('replaces broad catalog writes with scoped permissions for existing store admins', async () => {
        const roles = [
            {
                code: 'alpha-store-admin',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.CreateCatalog,
                    Permission.UpdateCatalog,
                    Permission.DeleteCatalog,
                ],
            },
        ];
        const save = vi.fn(async () => roles);
        const find = vi.fn(async () => roles);
        const queryRunner = {
            manager: { getRepository: vi.fn(() => ({ find, save })) },
        } as unknown as QueryRunner;

        await new HardenStoreAdministratorPermissions1786769400000().up(queryRunner);

        expect(roles[0].permissions).toEqual(
            expect.arrayContaining([
                Permission.ReadCatalog,
                Permission.CreateProduct,
                Permission.UpdateProduct,
                Permission.DeleteProduct,
                Permission.CreateCollection,
                Permission.ReadCollection,
                Permission.UpdateCollection,
                Permission.DeleteCollection,
            ]),
        );
        expect(roles[0].permissions).not.toContain(Permission.UpdateCatalog);
        expect(roles[0].permissions).not.toContain(Permission.DeleteCatalog);
        expect(save).toHaveBeenCalledOnce();
    });

    it('creates the merchant password gate with portable MySQL column types', async () => {
        const createdTables: Table[] = [];
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn(async () => false),
            createTable: vi.fn(async (table: Table) => createdTables.push(table)),
        } as unknown as QueryRunner;

        await new AddStoreAdministratorAccess1786767600000().up(queryRunner);

        expect(createdTables).toHaveLength(1);
        expect(createdTables[0].findColumnByName('mustChangePassword')).toMatchObject({
            type: 'tinyint',
            default: 1,
        });
        expect(createdTables[0].findColumnByName('createdAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
        });
        expect(createdTables[0].indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'IDX_store_administrator_access_user',
                    isUnique: true,
                }),
            ]),
        );
    });

    it('creates the store profile table with portable MySQL column types and backfills Channels', async () => {
        const execute = vi.fn(async () => undefined);
        const values = vi.fn(() => ({ execute }));
        const into = vi.fn(() => ({ values }));
        const insert = vi.fn(() => ({ into }));
        const createdTables: Table[] = [];
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn(async () => false),
            createTable: vi.fn(async (table: Table) => createdTables.push(table)),
            query: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
            manager: { createQueryBuilder: vi.fn(() => ({ insert })) },
        } as unknown as QueryRunner;

        await new AddStoreProfiles1786765800000().up(queryRunner);

        expect(createdTables).toHaveLength(1);
        expect(createdTables[0].findColumnByName('createdAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
        });
        expect(createdTables[0].findColumnByName('updatedAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            onUpdate: 'CURRENT_TIMESTAMP(6)',
        });
        expect(createdTables[0].findColumnByName('isPublished')).toMatchObject({
            type: 'tinyint',
            default: 0,
        });
        expect(createdTables[0].findColumnByName('descriptionZh')?.default).toBeUndefined();
        expect(values).toHaveBeenCalledWith([
            expect.objectContaining({ channelId: 1, status: 'DRAFT', sortOrder: 0 }),
            expect.objectContaining({ channelId: 2, status: 'DRAFT', sortOrder: 1 }),
        ]);
        expect(execute).toHaveBeenCalledOnce();
    });

    it('creates MySQL content tables without defaults on text columns', async () => {
        const { changeColumn, createdTables, queryRunner } = mysqlQueryRunner();

        await new AddStorefrontContent1786762500000().up(queryRunner);

        const columns = createdTables.flatMap(table => table.columns);
        expect(columns.find(column => column.name === 'body')?.default).toBeUndefined();
        expect(columns.find(column => column.name === 'description')?.default).toBeUndefined();
        expect(columns.find(column => column.name === 'createdAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
        });
        expect(columns.find(column => column.name === 'updatedAt')).toMatchObject({
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
        });
        expect(columns.find(column => column.name === 'enabled')).toMatchObject({
            type: 'tinyint',
            default: 1,
        });
        expect(changeColumn).toHaveBeenCalled();
    });

    it('resumes after an earlier attempt created only the block table', async () => {
        const { changeColumn, createdTables, queryRunner } = mysqlQueryRunner(['storefront_content_block']);

        await new AddStorefrontContent1786762500000().up(queryRunner);

        expect(createdTables.map(table => table.name)).toEqual([
            'storefront_content_block_translation',
            'storefront_content_item',
            'storefront_content_item_translation',
        ]);
        expect(changeColumn).toHaveBeenCalledWith(
            'storefront_content_block',
            'createdAt',
            expect.any(TableColumn),
        );
    });

    it('uses longtext for Vendure text custom fields on MySQL', async () => {
        const addColumn = vi.fn(async () => undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn(async () => new Table({ name: 'order', columns: [] })),
            addColumn,
        } as unknown as QueryRunner;

        await new AddCustomerOrderNote1786764000000().up(queryRunner);

        expect(addColumn).toHaveBeenCalledWith(
            'order',
            expect.objectContaining({
                name: 'customFieldsCustomernote',
                type: 'longtext',
                isNullable: true,
            }),
        );
    });
});
