/* eslint-disable @typescript-eslint/require-await -- QueryRunner mocks preserve async database APIs. */
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
import { AddOrderDeliveryEmail1787206600000 } from './1787206600000-add-order-delivery-email';
import { AlignSearchStockDefaults1787328000000 } from './1787328000000-align-search-stock-defaults';
import { NormalizeSearchStockMysqlColumns1787331600000 } from './1787331600000-normalize-search-stock-mysql-columns';
import { AddStorefrontContentSettings1787335200000 } from './1787335200000-add-storefront-content-settings';
import { AddStorefrontPromotionPages1787338800000 } from './1787338800000-add-storefront-promotion-pages';
import { AddStoreProfileNotesAndTemplates1787500800000 } from './1787500800000-add-store-profile-notes-and-templates';
import { UpgradeStorefrontContentEditor1787551200000 } from './1787551200000-upgrade-storefront-content-editor';
import { AddSystemAnnouncements1787554800000 } from './1787554800000-add-system-announcements';
import { AddAutoCardDelivery1787594400000 } from './1787594400000-add-auto-card-delivery';
import { AddCouponLifecycle1787677200000 } from './1787677200000-add-coupon-lifecycle';

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
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable coupon lifecycle storage on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const addedColumns: Array<{ table: string; column: TableColumn }> = [];
            const afterSalesTable = new Table({
                name: 'after_sales_request',
                columns: [{ name: 'id', type: databaseType === 'mysql' ? 'int' : 'integer' }],
            });
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(async (name: string) => name === 'after_sales_request'),
                getTable: vi.fn(async () => afterSalesTable),
                createTable: vi.fn(async (table: Table) => createdTables.push(table)),
                addColumn: vi.fn(async (table: string, column: TableColumn) => {
                    addedColumns.push({ table, column });
                }),
                createIndex: vi.fn(async () => undefined),
                createForeignKey: vi.fn(async () => undefined),
            } as unknown as QueryRunner;

            await new AddCouponLifecycle1787677200000().up(queryRunner);

            expect(createdTables.map(table => table.name)).toEqual([
                'store_coupon_campaign_config',
                'customer_coupon',
                'coupon_ledger_entry',
                'coupon_order_allocation',
            ]);
            const config = createdTables[0];
            const coupon = createdTables[1];
            expect(config.findColumnByName('id')?.type).toBe(databaseType === 'mysql' ? 'int' : 'integer');
            expect(config.findColumnByName('returnOnCancellation')?.type).toBe(
                databaseType === 'mysql' ? 'tinyint' : 'boolean',
            );
            expect(coupon.findColumnByName('discountRate')?.type).toBe(
                databaseType === 'postgres' ? 'double precision' : 'float',
            );
            expect(coupon.findColumnByName('version')?.default).toBeUndefined();
            expect(config.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_store_coupon_campaign_config_promotion',
                        isUnique: true,
                    }),
                ]),
            );
            expect(addedColumns.map(item => item.column.name)).toEqual(['refundId', 'refundedAt']);
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable automatic credential delivery storage on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const addedColumns: Array<{ table: string; column: TableColumn }> = [];
            const baseTables = {
                product_variant: new Table({
                    name: 'product_variant',
                    columns: [{ name: 'id', type: 'int' }],
                }),
                order_line: new Table({ name: 'order_line', columns: [{ name: 'id', type: 'int' }] }),
            };
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(async () => false),
                getTable: vi.fn(async (name: keyof typeof baseTables) => {
                    const table = baseTables[name];
                    return table
                        ? new Table({
                              name: table.name,
                              columns: [
                                  ...table.columns,
                                  ...addedColumns
                                      .filter(item => item.table === name)
                                      .map(item => item.column),
                              ],
                          })
                        : undefined;
                }),
                addColumn: vi.fn(async (table: string, column: TableColumn) => {
                    addedColumns.push({ table, column });
                }),
                createTable: vi.fn(async (createdTable: Table) => createdTables.push(createdTable)),
            } as unknown as QueryRunner;

            await new AddAutoCardDelivery1787594400000().up(queryRunner);

            expect(addedColumns.map(item => `${item.table}.${item.column.name}`)).toEqual([
                'product_variant.customFieldsDigitaldeliverymode',
                'order_line.customFieldsDigitaldeliverymodesnapshot',
            ]);
            expect(createdTables.map(table => table.name)).toEqual([
                'auto_card_config',
                'auto_card_delivery',
                'auto_card_pool_item',
                'auto_card_delivery_event',
            ]);
            const config = createdTables[0];
            const delivery = createdTables[1];
            expect(config.findColumnByName('id')?.type).toBe(databaseType === 'mysql' ? 'int' : 'integer');
            expect(config.findColumnByName('instructions')).toMatchObject({ type: 'text' });
            expect(config.findColumnByName('instructions')?.default).toBeUndefined();
            expect(delivery.findColumnByName('instructionsSnapshot')?.default).toBeUndefined();
            expect(createdTables[2].indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_auto_card_pool_config_fingerprint',
                        isUnique: true,
                    }),
                    expect.objectContaining({
                        name: 'IDX_auto_card_pool_config_sequence',
                        isUnique: true,
                    }),
                ]),
            );
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable system announcement storage on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(async () => false),
                createTable: vi.fn(async (createdTable: Table) => createdTables.push(createdTable)),
            } as unknown as QueryRunner;

            await new AddSystemAnnouncements1787554800000().up(queryRunner);

            expect(createdTables).toHaveLength(1);
            const table = createdTables[0];
            expect(table.name).toBe('system_announcement');
            expect(table.findColumnByName('enabled')?.type).toBe(
                databaseType === 'mysql' ? 'tinyint' : 'boolean',
            );
            expect(table.findColumnByName('startsAt')).toMatchObject({ isNullable: true });
            expect(table.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'IDX_system_announcement_schedule' }),
                ]),
            );
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds portable storefront editor fields and Asset relations on %s',
        async databaseType => {
            const initialTables = {
                asset: new Table({ name: 'asset', columns: [{ name: 'id', type: 'int' }] }),
                storefront_content_block: new Table({
                    name: 'storefront_content_block',
                    columns: [
                        { name: 'id', type: 'int' },
                        { name: 'code', type: 'varchar' },
                    ],
                }),
                storefront_content_item: new Table({
                    name: 'storefront_content_item',
                    columns: [{ name: 'id', type: 'int' }],
                }),
            };
            const addedColumns: Array<{ table: string; column: TableColumn }> = [];
            const createIndex = vi.fn(async () => undefined);
            const createForeignKey = vi.fn(async () => undefined);
            const query = vi.fn(async () => undefined);
            const getTable = vi.fn(async (name: keyof typeof initialTables) => {
                const source = initialTables[name];
                if (!source) return undefined;
                return new Table({
                    name: source.name,
                    columns: [
                        ...source.columns,
                        ...addedColumns.filter(item => item.table === source.name).map(item => item.column),
                    ],
                });
            });
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable,
                addColumn: vi.fn(async (table: Table, column: TableColumn) => {
                    addedColumns.push({ table: table.name, column });
                }),
                createIndex,
                createForeignKey,
                query,
            } as unknown as QueryRunner;

            await new UpgradeStorefrontContentEditor1787551200000().up(queryRunner);

            expect(addedColumns).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        table: 'storefront_content_block',
                        column: expect.objectContaining({ name: 'internalName', type: 'varchar' }),
                    }),
                    expect.objectContaining({
                        table: 'storefront_content_block',
                        column: expect.objectContaining({ name: 'layoutVariant', type: 'varchar' }),
                    }),
                    expect.objectContaining({
                        table: 'storefront_content_block',
                        column: expect.objectContaining({ name: 'settings', type: 'text' }),
                    }),
                    expect.objectContaining({
                        table: 'storefront_content_item',
                        column: expect.objectContaining({ name: 'settings', type: 'text' }),
                    }),
                ]),
            );
            const imageAssetColumns = addedColumns.filter(item => item.column.name === 'imageAssetId');
            expect(imageAssetColumns).toHaveLength(2);
            expect(
                imageAssetColumns.every(
                    item => item.column.type === (databaseType === 'mysql' ? 'int' : 'integer'),
                ),
            ).toBe(true);
            expect(createIndex).toHaveBeenCalledTimes(2);
            expect(createForeignKey).toHaveBeenCalledTimes(2);
            expect(query.mock.calls.at(-1)?.[0]).toContain('UPDATE "storefront_content_block"');
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds portable store notes and provisioning template markers on %s',
        async databaseType => {
            const addedColumns: Array<{ table: string; column: TableColumn }> = [];
            const tables = {
                channel: new Table({ name: 'channel', columns: [] }),
                store_profile: new Table({ name: 'store_profile', columns: [] }),
            };
            const query = vi.fn(async () => undefined);
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn(async (name: keyof typeof tables) => tables[name]),
                addColumn: vi.fn(async (table: string, column: TableColumn) => {
                    addedColumns.push({ table, column });
                }),
                query,
            } as unknown as QueryRunner;

            await new AddStoreProfileNotesAndTemplates1787500800000().up(queryRunner);

            expect(addedColumns).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        table: 'store_profile',
                        column: expect.objectContaining({ name: 'internalNote', type: 'text' }),
                    }),
                    expect.objectContaining({
                        table: 'channel',
                        column: expect.objectContaining({
                            name: 'customFieldsIsstoreprovisioningtemplate',
                            type: databaseType === 'mysql' ? 'tinyint' : 'boolean',
                        }),
                    }),
                ]),
            );
            expect(query.mock.calls.at(-1)?.[0]).toContain('UPDATE "channel"');
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable per-Channel promotion pages on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(async () => false),
                createTable: vi.fn(async (table: Table) => createdTables.push(table)),
            } as unknown as QueryRunner;

            await new AddStorefrontPromotionPages1787338800000().up(queryRunner);

            expect(createdTables).toHaveLength(1);
            expect(createdTables[0].name).toBe('storefront_promotion_page');
            expect(createdTables[0].findColumnByName('draftSource')).toMatchObject({
                type: 'text',
                isNullable: true,
            });
            expect(createdTables[0].indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_storefront_promotion_page_channel',
                        isUnique: true,
                    }),
                ]),
            );
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable per-Channel storefront content settings on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(async () => false),
                createTable: vi.fn(async (table: Table) => {
                    createdTables.push(table);
                }),
            } as unknown as QueryRunner;

            await new AddStorefrontContentSettings1787335200000().up(queryRunner);

            expect(createdTables).toHaveLength(1);
            expect(createdTables[0].name).toBe('storefront_content_settings');
            expect(createdTables[0].findColumnByName('heroAutoplayIntervalSeconds')).toMatchObject({
                type: 'int',
                default: 5,
            });
            expect(createdTables[0].indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_storefront_content_settings_channel',
                        isUnique: true,
                    }),
                ]),
            );
        },
    );

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

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds a portable nullable delivery email column on %s',
        async databaseType => {
            const addColumn = vi.fn(async () => undefined);
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn(async () => new Table({ name: 'order', columns: [] })),
                addColumn,
            } as unknown as QueryRunner;

            await new AddOrderDeliveryEmail1787206600000().up(queryRunner);

            expect(addColumn).toHaveBeenCalledWith(
                'order',
                expect.objectContaining({
                    name: 'customFieldsDeliveryemail',
                    type: 'varchar',
                    length: '254',
                    isNullable: true,
                }),
            );
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'aligns search stock defaults without changing column metadata on %s',
        async databaseType => {
            const table = new Table({
                name: 'search_index_item',
                columns: [
                    new TableColumn({ name: 'inStock', type: 'boolean', isNullable: false }),
                    new TableColumn({ name: 'productInStock', type: 'boolean', isNullable: false }),
                ],
            });
            const changeColumn = vi.fn(() => Promise.resolve(undefined));
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn(() => Promise.resolve(table)),
                changeColumn,
            } as unknown as QueryRunner;

            await new AlignSearchStockDefaults1787328000000().up(queryRunner);

            expect(changeColumn).toHaveBeenCalledTimes(2);
            for (const [, originalColumn, updatedColumn] of changeColumn.mock.calls) {
                expect(updatedColumn).not.toBe(originalColumn);
                expect(updatedColumn).toMatchObject({
                    type: 'boolean',
                    isNullable: false,
                    default: true,
                });
            }
        },
    );

    it.each(['mysql', 'mariadb'] as const)(
        'normalizes legacy search stock display widths on %s',
        async databaseType => {
            const table = new Table({
                name: 'search_index_item',
                columns: [
                    new TableColumn({
                        name: 'inStock',
                        type: 'tinyint',
                        width: 1,
                        default: "'1'",
                    }),
                    new TableColumn({
                        name: 'productInStock',
                        type: 'tinyint',
                        width: 1,
                        default: "'1'",
                    }),
                ],
            });
            const changeColumn = vi.fn(() => Promise.resolve(undefined));
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn(() => Promise.resolve(table)),
                changeColumn,
            } as unknown as QueryRunner;

            await new NormalizeSearchStockMysqlColumns1787331600000().up(queryRunner);

            expect(changeColumn).toHaveBeenCalledTimes(2);
            for (const [, originalColumn, updatedColumn] of changeColumn.mock.calls) {
                expect(updatedColumn).not.toBe(originalColumn);
                expect(updatedColumn).toMatchObject({
                    type: 'tinyint',
                    default: 1,
                    isNullable: false,
                });
                expect(updatedColumn.width).toBeUndefined();
            }
        },
    );

    it.each(['postgres', 'sqlite'] as const)('skips MySQL column normalization on %s', async databaseType => {
        const getTable = vi.fn(() => Promise.resolve(undefined));
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
        } as unknown as QueryRunner;

        await new NormalizeSearchStockMysqlColumns1787331600000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });
});
