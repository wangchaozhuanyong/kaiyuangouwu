import {
    CurrencyCode,
    GlobalFlag,
    LanguageCode,
    Permission,
    SortOrder,
} from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import {
    buildInventoryAlertOverview,
    CatalogOperationsService,
    DEFAULT_REPLENISHMENT_THRESHOLD,
} from './catalog-operations.service';
import { manageCatalogOperationsPermission } from './constants';

function createService() {
    const txCtx = {
        channelId: 'channel-1',
        languageCode: 'zh_Hans',
        channel: { defaultCurrencyCode: CurrencyCode.CNY },
    };
    const relationAdd = vi.fn(() => Promise.resolve());
    const collectionRepository = {
        save: vi.fn(value => Promise.resolve(value)),
        createQueryBuilder: vi.fn(() => ({
            relation: vi.fn(() => ({
                of: vi.fn(() => ({ add: relationAdd })),
            })),
        })),
    };
    const connection = {
        withTransaction: vi.fn((_ctx, work) => Promise.resolve(work(txCtx))),
        getEntityOrThrow: vi.fn(),
        getRepository: vi.fn((): any => collectionRepository),
    };
    const productService = {
        create: vi.fn(() => Promise.resolve({ id: 'product-new', name: '新商品' })),
        update: vi.fn(() => Promise.resolve({ id: 'product-1' })),
        findAll: vi.fn(),
    };
    const productVariantService = {
        create: vi.fn(),
        findAll: vi.fn(),
        getVariantsByProductId: vi.fn(() =>
            Promise.resolve({
                items: [{ id: 'variant-1' }],
                totalItems: 1,
            }),
        ),
    };
    const eventBus = { publish: vi.fn(() => Promise.resolve()) };
    const service = new CatalogOperationsService(
        connection as never,
        productService as never,
        productVariantService as never,
        {} as never,
        {} as never,
        eventBus as never,
    );
    return {
        collectionRepository,
        connection,
        eventBus,
        productService,
        productVariantService,
        relationAdd,
        service,
        txCtx,
    };
}

function queryBuilderReturning<T>(items: T[]) {
    const builder = {
        leftJoinAndSelect: vi.fn(),
        where: vi.fn(),
        getMany: vi.fn().mockResolvedValue(items),
    };
    builder.leftJoinAndSelect.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    return builder;
}

const productInput = {
    id: 'product-1',
    enabled: true,
};

const variantInput = {
    productVariantId: 'variant-1',
    stockLocationId: 'stock-1',
    currencyCode: 'CNY' as const,
};

function inventoryRow(variantId: string, stockLevels: Array<ReturnType<typeof stockLevel>>) {
    return {
        productId: `product-${variantId}`,
        productName: `商品 ${variantId}`,
        variantId,
        variantName: `规格 ${variantId}`,
        sku: `SKU-${variantId}`,
        productEnabled: true,
        variantEnabled: true,
        trackInventory: GlobalFlag.INHERIT,
        stockLevels,
    };
}

function stockLevel(
    stockLocationId: string,
    stockOnHand: number,
    stockAllocated: number,
    minimumStock: number | null,
) {
    return {
        stockLocationId,
        stockLocationName: `仓库 ${stockLocationId}`,
        stockOnHand,
        stockAllocated,
        minimumStock,
    };
}

function authorizedContext(
    permissions = [Permission.UpdateProduct, manageCatalogOperationsPermission.Update],
) {
    return {
        userHasPermissions: (requested: Permission[]) =>
            requested.some(permission => permissions.includes(permission)),
    };
}

describe('CatalogOperationsService', () => {
    it('builds full-store alerts once per SKU and separates out-of-stock from low stock', () => {
        const overview = buildInventoryAlertOverview(
            [
                inventoryRow('low', [stockLevel('a', 8, 4, null), stockLevel('b', 20, 1, 3)]),
                inventoryRow('out', [stockLevel('a', 2, 3, 5), stockLevel('b', 0, 0, null)]),
                inventoryRow('healthy', [stockLevel('a', 20, 2, 5)]),
            ],
            true,
        );

        expect(overview.defaultReplenishmentThreshold).toBe(DEFAULT_REPLENISHMENT_THRESHOLD);
        expect(overview.lowStockSkuCount).toBe(1);
        expect(overview.outOfStockSkuCount).toBe(1);
        expect(overview.items.map(item => item.variantId)).toEqual(['low', 'out', 'healthy']);
        expect(overview.items[0]).toMatchObject({
            stockOnHand: 28,
            stockAllocated: 5,
            stockAvailable: 23,
            status: 'LOW_STOCK',
        });
        expect(overview.items[0].locations[0]).toMatchObject({
            stockAvailable: 4,
            replenishmentThreshold: 5,
            usesDefaultThreshold: true,
            status: 'LOW_STOCK',
        });
    });

    it('excludes disabled and non-tracked SKUs from replenishment alerts', () => {
        const explicitUntracked = inventoryRow('untracked', [stockLevel('a', 0, 0, null)]);
        explicitUntracked.trackInventory = GlobalFlag.FALSE;
        const inheritedUntracked = inventoryRow('inherited', [stockLevel('a', 0, 0, null)]);
        const disabled = inventoryRow('disabled', [stockLevel('a', 0, 0, null)]);
        disabled.variantEnabled = false;

        expect(buildInventoryAlertOverview([explicitUntracked, disabled], true).items).toEqual([]);
        expect(buildInventoryAlertOverview([inheritedUntracked], false).items).toEqual([]);
    });

    it('deduplicates repeated catalog rows by SKU while retaining their warehouse details', () => {
        const first = inventoryRow('first', [stockLevel('a', 4, 0, 5)]);
        const duplicate = inventoryRow('duplicate', [stockLevel('b', 8, 1, 5)]);
        duplicate.sku = first.sku;

        const overview = buildInventoryAlertOverview([first, duplicate], true);

        expect(overview.items).toHaveLength(1);
        expect(overview.lowStockSkuCount).toBe(1);
        expect(overview.items[0]).toMatchObject({
            sku: first.sku,
            stockOnHand: 12,
            stockAllocated: 1,
            stockAvailable: 11,
        });
        expect(overview.items[0].locations.map(level => level.productVariantId)).toEqual([
            'first',
            'duplicate',
        ]);
    });

    it('treats an active tracked SKU without a warehouse row as out of stock', () => {
        const overview = buildInventoryAlertOverview([inventoryRow('missing-location', [])], true);

        expect(overview.outOfStockSkuCount).toBe(1);
        expect(overview.items[0]).toMatchObject({
            variantId: 'missing-location',
            stockAvailable: 0,
            status: 'OUT_OF_STOCK',
            locations: [],
        });
    });

    it('updates only the current-store replenishment threshold and preserves the stock ceiling', async () => {
        const { connection, service } = createService();
        vi.spyOn(service, 'stockLocations').mockResolvedValue([{ id: 'stock-1', name: '主仓' }]);
        connection.getEntityOrThrow.mockResolvedValue({ id: 'variant-1' });
        connection.getRepository
            .mockImplementationOnce(
                () => ({ findOne: vi.fn().mockResolvedValue({ id: 'level-1' }) }) as never,
            )
            .mockImplementationOnce(
                () => ({ findOne: vi.fn().mockResolvedValue({ maximumStock: 20 }) }) as never,
            );
        const savePolicy = vi.spyOn(service, 'savePolicy').mockResolvedValue({} as never);

        await expect(
            service.updateInventoryThreshold({ channelId: 'channel-1' } as never, {
                productVariantId: 'variant-1',
                stockLocationId: 'stock-1',
                threshold: 7,
            }),
        ).resolves.toEqual({
            productVariantId: 'variant-1',
            stockLocationId: 'stock-1',
            replenishmentThreshold: 7,
            usesDefaultThreshold: false,
        });
        expect(savePolicy).toHaveBeenCalledWith(expect.anything(), 'variant-1', 'stock-1', 7, 20);
    });

    it('rejects replenishment updates for a warehouse outside the active store', async () => {
        const { service } = createService();
        vi.spyOn(service, 'stockLocations').mockResolvedValue([]);

        await expect(
            service.updateInventoryThreshold({ channelId: 'channel-1' } as never, {
                productVariantId: 'variant-1',
                stockLocationId: 'other-store-stock',
                threshold: 5,
            }),
        ).rejects.toThrow('所选库存点不属于当前店铺');
    });

    it('creates the product, first SKU, cost, stock policy and category in one transaction', async () => {
        const {
            collectionRepository,
            connection,
            eventBus,
            productService,
            productVariantService,
            relationAdd,
            service,
            txCtx,
        } = createService();
        const collection = { id: 'collection-1', filters: [] };
        connection.getEntityOrThrow.mockResolvedValue(collection);
        productVariantService.create.mockResolvedValue([{ id: 'variant-new' }]);
        vi.spyOn(service, 'requireStockLocation').mockResolvedValue({} as never);
        const savePolicy = vi.spyOn(service, 'savePolicy').mockResolvedValue({} as never);
        const recordCost = vi.spyOn(service, 'recordCost').mockResolvedValue({} as never);

        await expect(
            service.createProduct(
                authorizedContext([
                    Permission.CreateProduct,
                    manageCatalogOperationsPermission.Update,
                ]) as never,
                {
                    product: {
                        enabled: true,
                        translations: [
                            {
                                languageCode: LanguageCode.zh_Hans,
                                name: '新商品',
                                slug: 'new-product',
                                description: '说明',
                            },
                        ],
                    },
                    variant: {
                        stockLocationId: 'stock-1',
                        sku: 'NEW-001',
                        enabled: true,
                        packageQuantity: 1,
                        sellingPrice: 1_000,
                        purchaseCostMicrounits: 7_000,
                        stockOnHand: 5,
                        minimumStock: 2,
                        maximumStock: 20,
                    },
                    collectionIds: ['collection-1'],
                },
            ),
        ).resolves.toEqual({ id: 'product-new', name: '新商品' });

        expect(connection.withTransaction).toHaveBeenCalledOnce();
        expect(productService.create).toHaveBeenCalledWith(txCtx, expect.objectContaining({ enabled: true }));
        expect(productVariantService.create).toHaveBeenCalledWith(
            txCtx,
            expect.arrayContaining([
                expect.objectContaining({
                    productId: 'product-new',
                    sku: 'NEW-001',
                    prices: [{ currencyCode: CurrencyCode.CNY, price: 1_000 }],
                    stockLevels: [{ stockLocationId: 'stock-1', stockOnHand: 5 }],
                }),
            ]),
        );
        expect(savePolicy).toHaveBeenCalledWith(txCtx, 'variant-new', 'stock-1', 2, 20);
        expect(recordCost).toHaveBeenCalledWith(
            txCtx,
            'variant-new',
            CurrencyCode.CNY,
            7_000,
            'MANUAL',
            null,
        );
        expect(collectionRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                filters: [
                    expect.objectContaining({
                        code: 'product-id-filter',
                    }),
                ],
            }),
        );
        expect(relationAdd).toHaveBeenCalledWith('variant-new');
        expect(eventBus.publish).toHaveBeenCalledOnce();
    });

    it('rejects product creation without a category before opening a transaction', async () => {
        const { connection, service } = createService();

        await expect(
            service.createProduct(
                authorizedContext([
                    Permission.CreateProduct,
                    manageCatalogOperationsPermission.Update,
                ]) as never,
                {
                    product: { translations: [] },
                    variant: {
                        stockLocationId: 'stock-1',
                        sku: 'NEW-001',
                        packageQuantity: 1,
                        sellingPrice: 0,
                        purchaseCostMicrounits: 0,
                        stockOnHand: 0,
                    },
                    collectionIds: [],
                },
            ),
        ).rejects.toThrow('新增商品必须选择至少一个分类');
        expect(connection.withTransaction).not.toHaveBeenCalled();
    });

    it('reports products without SKUs and variant rows missing category or cost', async () => {
        const { productService, service } = createService();
        productService.findAll.mockResolvedValue({ items: [], totalItems: 3 });
        vi.spyOn(service, 'exportRows').mockResolvedValue({
            totalItems: 2,
            scannedItems: 2,
            items: [
                {
                    productId: 'product-1',
                    categories: [],
                    purchaseCostMicrounits: null,
                },
                {
                    productId: 'product-2',
                    categories: ['分类'],
                    purchaseCostMicrounits: 1_000,
                },
            ],
        } as never);

        await expect(service.integritySummary({} as never)).resolves.toEqual({
            totalProducts: 3,
            totalVariants: 2,
            productsWithoutVariants: 1,
            variantsWithoutCategory: 1,
            variantsWithoutCost: 1,
        });
    });

    it('saves the product and every operations record inside the same transaction context', async () => {
        const { connection, productService, productVariantService, service, txCtx } = createService();
        const updateVariant = vi.spyOn(service, 'updateVariant').mockResolvedValue(null);

        await expect(
            service.saveProduct(
                authorizedContext() as never,
                {
                    product: productInput,
                    variants: [variantInput],
                } as never,
            ),
        ).resolves.toEqual({ id: 'product-1' });

        expect(connection.withTransaction).toHaveBeenCalledOnce();
        expect(productService.update).toHaveBeenCalledWith(txCtx, productInput);
        expect(productVariantService.getVariantsByProductId).toHaveBeenCalledWith(txCtx, 'product-1', {
            take: 1_000,
        });
        expect(updateVariant).toHaveBeenCalledWith(txCtx, variantInput, false, false);
    });

    it('rejects a SKU from another product before writing operations data', async () => {
        const { productVariantService, service } = createService();
        productVariantService.getVariantsByProductId.mockResolvedValue({ items: [], totalItems: 0 });
        const updateVariant = vi.spyOn(service, 'updateVariant').mockResolvedValue(null);

        await expect(
            service.saveProduct(
                authorizedContext() as never,
                {
                    product: productInput,
                    variants: [variantInput],
                } as never,
            ),
        ).rejects.toThrow('SKU 不属于当前商品');
        expect(updateVariant).not.toHaveBeenCalled();
    });

    it('requires product permission and operations permission for a coordinated save', async () => {
        const { connection, service } = createService();

        await expect(
            service.saveProduct(
                authorizedContext([Permission.UpdateProduct]) as never,
                { product: productInput, variants: [variantInput] } as never,
            ),
        ).rejects.toThrow();
        expect(connection.withTransaction).not.toHaveBeenCalled();
    });

    it('creates a SKU and its cost and inventory policy in one transaction', async () => {
        const { connection, productVariantService, service, txCtx } = createService();
        const product = {
            id: 'product-1',
            optionGroups: [
                {
                    id: 'group-1',
                    name: '颜色',
                    options: [{ id: 'option-red' }],
                },
            ],
            variants: [],
        };
        connection.getEntityOrThrow.mockResolvedValue(product);
        productVariantService.create.mockResolvedValue([{ id: 'variant-new' }]);
        vi.spyOn(service, 'requireStockLocation').mockResolvedValue({} as never);
        const savePolicy = vi.spyOn(service, 'savePolicy').mockResolvedValue({} as never);
        const recordCost = vi.spyOn(service, 'recordCost').mockResolvedValue({} as never);
        vi.spyOn(service, 'workspace').mockResolvedValue({ productId: 'product-1' } as never);

        await expect(
            service.createVariant(
                authorizedContext([
                    Permission.CreateProduct,
                    manageCatalogOperationsPermission.Update,
                ]) as never,
                {
                    productId: 'product-1',
                    stockLocationId: 'stock-1',
                    name: '测试商品 红色',
                    sku: 'SKU-RED',
                    optionIds: ['option-red'],
                    enabled: true,
                    packageQuantity: 1,
                    sellingPrice: 1_000,
                    purchaseCostMicrounits: 7_000,
                    currencyCode: CurrencyCode.CNY,
                    stockOnHand: 5,
                    minimumStock: 2,
                    maximumStock: 20,
                },
            ),
        ).resolves.toEqual({ productId: 'product-1' });

        expect(connection.withTransaction).toHaveBeenCalledOnce();
        expect(productVariantService.create).toHaveBeenCalledWith(
            txCtx,
            expect.arrayContaining([
                expect.objectContaining({
                    productId: 'product-1',
                    sku: 'SKU-RED',
                    optionIds: ['option-red'],
                    stockLevels: [{ stockLocationId: 'stock-1', stockOnHand: 5 }],
                }),
            ]),
        );
        expect(savePolicy).toHaveBeenCalledWith(txCtx, 'variant-new', 'stock-1', 2, 20);
        expect(recordCost).toHaveBeenCalledWith(txCtx, 'variant-new', 'CNY', 7_000, 'MANUAL', null);
    });

    it('derives a saved lot expiry date from its production date and the SKU default shelf life', async () => {
        const { connection, service } = createService();
        const lotRepository = {
            findOne: vi.fn(() => Promise.resolve(null)),
            save: vi.fn(value => Promise.resolve(Object.assign(value, { id: 'lot-1' }))),
        };
        vi.spyOn(service, 'requireStockLocation').mockResolvedValue({} as never);
        connection.getEntityOrThrow.mockResolvedValue({
            id: 'variant-1',
            customFields: { shelfLifeDays: 30 },
        });
        connection.getRepository.mockReturnValue(lotRepository);

        const saved = await service.saveLot({ channelId: 'channel-1' } as never, {
            productVariantId: 'variant-1',
            stockLocationId: 'stock-1',
            lotCode: 'LOT-20260910',
            manufacturedAt: '2026-09-10T00:00:00.000Z',
            expiresAt: null,
            quantityOnHand: 0,
            purchaseCostMicrounits: null,
            currencyCode: CurrencyCode.CNY,
        });

        expect(saved.expiresAt).toEqual(new Date('2026-10-10T00:00:00.000Z'));
        expect(lotRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                manufacturedAt: new Date('2026-09-10T00:00:00.000Z'),
                expiresAt: new Date('2026-10-10T00:00:00.000Z'),
            }),
        );
    });

    it('filters summary rows by cost, margin, low stock and expiry', async () => {
        const { service } = createService();
        vi.spyOn(service, 'exportRows').mockResolvedValue({
            totalItems: 2,
            items: [
                {
                    productId: 'product-1',
                    productName: '低库存牛奶',
                    categories: ['乳制品'],
                    brand: '测试品牌',
                    productEnabled: true,
                    sku: 'MILK-001',
                    barcode: '690000000001',
                    sellingPrice: 1_000,
                    purchaseCostMicrounits: 7_000,
                    margin: 0.3,
                    stockLevels: [{ stockAvailable: 3, minimumStock: 5 }],
                    lots: [
                        {
                            expiresAt: new Date(Date.now() + 5 * 86_400_000),
                            quantityOnHand: 3,
                        },
                    ],
                },
                {
                    productId: 'product-2',
                    productName: '常温牛奶',
                    categories: ['乳制品'],
                    brand: '其他品牌',
                    productEnabled: true,
                    sku: 'MILK-002',
                    barcode: '690000000002',
                    sellingPrice: 1_000,
                    purchaseCostMicrounits: 9_500,
                    margin: 0.05,
                    stockLevels: [{ stockAvailable: 20, minimumStock: 5 }],
                    lots: [],
                },
            ],
        } as never);

        await expect(
            service.productSummaries({} as never, {
                brand: '测试',
                minimumPurchaseCostMicrounits: 6_000,
                maximumMargin: 0.4,
                lowStock: true,
                expiringWithinDays: 30,
            }),
        ).resolves.toEqual({ items: [{ productId: 'product-1' }], totalItems: 1 });
    });

    it('keeps advanced-filter IDs on the server and paginates the final product list', async () => {
        const { productService, service } = createService();
        vi.spyOn(service, 'matchingProductIds').mockResolvedValue(['product-1', 'product-2', 'product-3']);
        productService.findAll.mockResolvedValue({
            items: [
                { id: 'product-1', updatedAt: new Date('2026-01-01') },
                { id: 'product-2', updatedAt: new Date('2026-03-01') },
                { id: 'product-3', updatedAt: new Date('2026-02-01') },
            ],
            totalItems: 3,
        });

        await expect(
            service.filteredProducts(
                {} as never,
                { lowStock: true },
                {
                    skip: 1,
                    take: 1,
                    sort: { updatedAt: SortOrder.DESC },
                    filter: { enabled: { eq: true } },
                },
            ),
        ).resolves.toEqual({
            items: [{ id: 'product-3', updatedAt: new Date('2026-02-01') }],
            totalItems: 3,
        });
        expect(productService.findAll).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                skip: 0,
                take: 3,
                sort: undefined,
                filter: {
                    _and: [
                        { enabled: { eq: true } },
                        { id: { in: ['product-1', 'product-2', 'product-3'] } },
                    ],
                },
            }),
        );
    });

    it('bounds the public summary page instead of returning every matching ID', async () => {
        const { service } = createService();
        vi.spyOn(service, 'matchingProductIds').mockResolvedValue(['product-1', 'product-2', 'product-3']);

        await expect(service.productSummaries({} as never, {}, 1, 1)).resolves.toEqual({
            items: [{ productId: 'product-2' }],
            totalItems: 3,
        });
    });

    it('advances summary scans by source rows even when hydration omits a row', async () => {
        const { service } = createService();
        const exportRows = vi.spyOn(service, 'exportRows').mockResolvedValue({
            totalItems: 2,
            scannedItems: 2,
            items: [
                {
                    productId: 'product-1',
                    productName: '商品一',
                    categories: [],
                    brand: null,
                    productEnabled: true,
                    sku: 'SKU-1',
                    barcode: '',
                    sellingPrice: 100,
                    purchaseCostMicrounits: null,
                    margin: null,
                    stockLevels: [],
                    lots: [],
                },
            ],
        } as never);

        await expect(service.matchingProductIds({} as never, {})).resolves.toEqual(['product-1']);
        expect(exportRows).toHaveBeenCalledOnce();
    });

    it('safely handles unpopulated stockLocation, missing collections and missing translations in exportRows', async () => {
        const { service, productVariantService, connection } = createService();
        vi.spyOn(service, 'stockLocations').mockResolvedValue([{ id: 'stock-1', name: '主仓库' }]);
        (productVariantService as any).findAll = vi.fn().mockResolvedValue({
            items: [
                {
                    id: 'variant-1',
                    productId: 'product-1',
                    sku: 'SKU-SAFE-1',
                    price: 200,
                    currencyCode: CurrencyCode.CNY,
                    enabled: true,
                    customFields: {},
                },
            ],
            totalItems: 1,
        });
        const productQuery = queryBuilderReturning([
            {
                id: 'product-1',
                enabled: true,
                createdAt: new Date(),
                translations: [],
                facetValues: [],
            },
        ]);
        const collectionQuery = queryBuilderReturning([
            {
                id: 'variant-1',
                // collections may be unpopulated or missing
                collections: undefined,
            },
        ]);
        const stockLevelRepository = {
            find: vi.fn().mockResolvedValue([
                {
                    productVariantId: 'variant-1',
                    stockLocationId: 'stock-1',
                    stockLocation: undefined, // unpopulated relation!
                    stockOnHand: 15,
                    stockAllocated: 2,
                },
            ]),
        };
        const emptyRepository = { find: vi.fn().mockResolvedValue([]) };
        (connection as any).getRepository = vi.fn((_ctx: unknown, entity: unknown) => {
            const entityName = (entity as { name?: string })?.name;
            if (entityName === 'Product') return { createQueryBuilder: vi.fn(() => productQuery) };
            if (entityName === 'ProductVariant') return { createQueryBuilder: vi.fn(() => collectionQuery) };
            if (entityName === 'StockLevel') return stockLevelRepository;
            return emptyRepository;
        });
        const suppliersAssociations = vi.fn().mockResolvedValue([]);
        (service as any).suppliers = { associations: suppliersAssociations };

        const result = await service.exportRows({
            channel: { code: 'default' },
            languageCode: 'zh_Hans',
        } as never);
        expect(productVariantService.findAll).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ skip: 0, take: 10 }),
        );
        expect(productQuery.leftJoinAndSelect).toHaveBeenCalledWith('product.facetValues', 'facetValue');
        expect(collectionQuery.leftJoinAndSelect).toHaveBeenCalledWith(
            'collection.parent',
            'parentCollection',
        );
        expect(stockLevelRepository.find).toHaveBeenCalledWith(
            expect.objectContaining({ relations: ['stockLocation'] }),
        );
        expect(result.items).toHaveLength(1);
        expect(result.items[0].stockLevels).toEqual([
            {
                stockLocationId: 'stock-1',
                stockLocationName: '主仓库', // correctly resolved from locationNameById!
                stockOnHand: 15,
                stockAllocated: 2,
                stockAvailable: 13,
                minimumStock: null,
                maximumStock: null,
            },
        ]);
        expect(result.items[0].categories).toEqual([]);
    });

    it('exports the real parent-child collection path when a legacy marker is flattened', async () => {
        const { service, productVariantService, connection } = createService();
        vi.spyOn(service, 'stockLocations').mockResolvedValue([]);
        (productVariantService as any).findAll = vi.fn().mockResolvedValue({
            items: [
                {
                    id: 'variant-tobacco',
                    productId: 'product-tobacco',
                    sku: 'TOBACCO-1',
                    price: 200,
                    currencyCode: CurrencyCode.CNY,
                    enabled: true,
                    customFields: {},
                },
            ],
            totalItems: 1,
        });
        const child = {
            name: '泰山',
            translations: [{ languageCode: 'zh_Hans', name: '泰山' }],
            parent: {
                isRoot: false,
                translations: [{ languageCode: 'zh_Hans', name: '正品烟草' }],
            },
        };
        const productQuery = queryBuilderReturning([
            {
                id: 'product-tobacco',
                enabled: true,
                createdAt: new Date(),
                translations: [{ languageCode: 'zh_Hans', name: '泰山商品' }],
                facetValues: [
                    {
                        facet: { code: 'catalog-import-category' },
                        translations: [{ languageCode: 'zh_Hans', name: '泰山' }],
                    },
                ],
            },
        ]);
        const collectionQuery = queryBuilderReturning([{ id: 'variant-tobacco', collections: [child] }]);
        const emptyRepository = { find: vi.fn().mockResolvedValue([]) };
        (connection as any).getRepository = vi.fn((_ctx: unknown, entity: unknown) => {
            const entityName = (entity as { name?: string })?.name;
            if (entityName === 'Product') return { createQueryBuilder: vi.fn(() => productQuery) };
            if (entityName === 'ProductVariant') return { createQueryBuilder: vi.fn(() => collectionQuery) };
            return emptyRepository;
        });
        (service as any).suppliers = { associations: vi.fn().mockResolvedValue([]) };

        const result = await service.exportRows({
            channel: { code: 'meiyijia' },
            languageCode: 'zh_Hans',
        } as never);

        expect(result.items[0].importCategory).toBe('正品烟草 > 泰山');
        expect(result.items[0].categories).toEqual(expect.arrayContaining(['正品烟草 > 泰山', '泰山']));
        expect(collectionQuery.leftJoinAndSelect).toHaveBeenCalledWith(
            'parentCollection.translations',
            'parentCollectionTranslation',
        );
    });

    it('falls back to basic counts in integritySummary if an exception occurs during exportRows scan', async () => {
        const { service, productService, productVariantService } = createService();
        productService.findAll = vi.fn().mockResolvedValue({ totalItems: 10 });
        (productVariantService as any).findAll = vi.fn().mockResolvedValue({ totalItems: 25 });
        vi.spyOn(service, 'exportRows').mockRejectedValue(new Error('Database disk error'));

        const summary = await service.integritySummary({} as never);
        expect(summary).toEqual({
            totalProducts: 10,
            totalVariants: 25,
            productsWithoutVariants: 0,
            variantsWithoutCategory: 0,
            variantsWithoutCost: 0,
        });
    });
});
