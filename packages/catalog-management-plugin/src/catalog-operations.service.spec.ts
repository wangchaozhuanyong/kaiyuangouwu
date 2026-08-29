import { Permission } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { CatalogOperationsService } from './catalog-operations.service';
import { manageCatalogOperationsPermission } from './constants';

function createService() {
    const txCtx = { channelId: 'channel-1' };
    const connection = {
        withTransaction: vi.fn((_ctx, work) => Promise.resolve(work(txCtx))),
    };
    const productService = {
        update: vi.fn(() => Promise.resolve({ id: 'product-1' })),
    };
    const productVariantService = {
        getVariantsByProductId: vi.fn(() =>
            Promise.resolve({
                items: [{ id: 'variant-1' }],
                totalItems: 1,
            }),
        ),
    };
    const service = new CatalogOperationsService(
        connection as never,
        productService as never,
        productVariantService as never,
        {} as never,
    );
    return { connection, productService, productVariantService, service, txCtx };
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
});
