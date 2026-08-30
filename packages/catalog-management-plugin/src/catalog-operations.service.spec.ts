import { CurrencyCode, LanguageCode, Permission, SortOrder } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { CatalogOperationsService } from './catalog-operations.service';
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
        getRepository: vi.fn(() => collectionRepository),
    };
    const productService = {
        create: vi.fn(() => Promise.resolve({ id: 'product-new', name: '新商品' })),
        update: vi.fn(() => Promise.resolve({ id: 'product-1' })),
        findAll: vi.fn(),
    };
    const productVariantService = {
        create: vi.fn(),
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

const productInput = {
    id: 'product-1',
    enabled: true,
};

const variantInput = {
    productVariantId: 'variant-1',
    stockLocationId: 'stock-1',
    currencyCode: 'CNY' as const,
};

function authorizedContext(
    permissions = [Permission.UpdateProduct, manageCatalogOperationsPermission.Update],
) {
    return {
        userHasPermissions: (requested: Permission[]) =>
            requested.some(permission => permissions.includes(permission)),
    };
}

describe('CatalogOperationsService', () => {
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
});
