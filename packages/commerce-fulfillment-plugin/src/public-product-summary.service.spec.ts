import { RequestContextCacheService } from '@vendure/core';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { PublicProductSummaryService } from './public-product-summary.service';

function harness() {
    const product = {
        id: 'p1',
        enabled: true,
        createdAt: new Date('2026-01-01'),
        name: '商品',
        slug: 'product',
        description: '<p>详情</p>',
        featuredAsset: { id: 'image', preview: 'preview/image.webp' },
        customFields: {
            fulfillmentType: 'physical',
            pricingMode: 'FIXED',
            refundPolicy: 'MERCHANT_REVIEW',
            manualDeliverySlaMinutes: 30,
            unrelatedPrivateField: 'synthetic-private',
        },
    };
    const variant = {
        id: 'v1',
        name: '规格',
        sku: 'sku',
        featuredAsset: null,
        customFields: { fulfillmentType: 'physical' },
        product,
    };
    const products = {
        findAll: vi.fn().mockResolvedValue({ items: [product], totalItems: 1 }),
        findOne: vi.fn().mockResolvedValue(product),
    };
    const variants = {
        getVariantsForProduct: vi.fn().mockResolvedValue([variant]),
        getSaleableStockLevelForDisplay: vi.fn().mockResolvedValue(9),
        hydratePriceFields: vi.fn((_ctx, _variant, field) =>
            Promise.resolve(field === 'priceWithTax' ? 1234 : 'MYR'),
        ),
    };
    const assets = { getEntityAssets: vi.fn().mockResolvedValue([product.featuredAsset]) };
    const packaging = {
        configForProduct: vi.fn().mockResolvedValue({
            id: 'pack',
            enabled: true,
            autoUnpack: true,
            unitLabel: '件',
            packageLabel: '箱',
            unitsPerPackage: 12,
            unitVariant: variant,
            packageVariant: { id: 'v2', sku: 'case' },
            unrelatedPrivateField: 'synthetic-private',
        }),
    };
    const locale = {
        hydrateLocaleStringField: vi.fn((_ctx, value) =>
            Promise.resolve(value.id === 'v1' ? '规格' : '整箱'),
        ),
    };
    const service = new PublicProductSummaryService(
        products as any,
        variants as any,
        {
            getCollectionsByProductId: vi
                .fn()
                .mockResolvedValue([{ id: 'cat', name: '分类', slug: 'category', parentId: 'root' }]),
        } as any,
        { availableStockForDisplay: vi.fn().mockResolvedValue(null) } as any,
        {
            availableForDisplay: vi.fn().mockResolvedValue(undefined),
            configForDisplay: vi.fn().mockResolvedValue(null),
        } as any,
        { getRepository: () => ({ find: vi.fn().mockResolvedValue([]) }) } as any,
        new RequestContextCacheService(),
        {
            assetOptions: {
                assetStorageStrategy: { toAbsoluteUrl: (_req: unknown, value: string) => `/assets/${value}` },
            },
        } as any,
        assets as any,
        packaging as any,
        locale as any,
    );
    const ctx = { apiType: 'shop', channelId: 'A', req: {} } as any;
    return { service, product, products, variants, assets, packaging, ctx };
}

describe('public product summary adapter', () => {
    it('uses anonymous channel-scoped reads and leaves detail data out of the summary', async () => {
        const h = harness();
        const page = await h.service.list(h.ctx, { take: 12, collectionId: 'cat', term: ' 商品 ' });
        expect(h.products.findAll).toHaveBeenCalledWith(
            h.ctx,
            expect.objectContaining({
                filter: { enabled: { eq: true }, collectionId: { eq: 'cat' }, name: { contains: '商品' } },
            }),
            ['featuredAsset'],
        );
        expect(page.items[0]).toMatchObject({
            id: 'p1',
            descriptionSummary: '详情',
            descriptionSubtitle: null,
            warrantyDuration: null,
            featuredAsset: { preview: '/assets/preview/image.webp' },
            variants: [
                {
                    priceWithTax: 1234,
                    currencyCode: 'MYR',
                    saleableStockLevel: 9,
                    autoCardAvailableStock: null,
                },
            ],
        });
        expect(page.items[0]).not.toHaveProperty('description');
        expect(page.items[0]).not.toHaveProperty('assets');
        expect(page.items[0].customFields).not.toHaveProperty('unrelatedPrivateField');
        expect(h.assets.getEntityAssets).not.toHaveBeenCalled();
        expect(h.packaging.configForProduct).not.toHaveBeenCalled();
        expect(h.variants.hydratePriceFields).toHaveBeenCalledWith(h.ctx, expect.any(Object), 'priceWithTax');
    });

    it('projects compact text but keeps warranty from the complete body and returns full detail on demand', async () => {
        const h = harness();
        h.product.name = '独立商品名称';
        h.product.description = `<p>${'正常说明'.repeat(50)}</p><p>Warranty for 24 months</p>`;
        const page = await h.service.list(h.ctx);
        expect(page.items[0]).toMatchObject({
            descriptionSummary: `${'正常说明'.repeat(18)}…`,
            descriptionSubtitle: `${'正常说明'.repeat(18)}…`,
            warrantyDuration: '24 months',
        });
        expect(page.items[0]).not.toHaveProperty('description');
        expect((await h.service.detail(h.ctx, h.product.id))?.description).toBe(h.product.description);
    });

    it('loads detail assets and packaging through existing business readers with localized variant names', async () => {
        const h = harness();
        const detail = await h.service.detail(h.ctx, 'p1');
        expect(detail).toMatchObject({
            description: '<p>详情</p>',
            assets: [{ id: 'image', preview: '/assets/preview/image.webp' }],
            packaging: {
                unitsPerPackage: 12,
                unitVariant: { id: 'v1', name: '规格', sku: 'sku' },
                packageVariant: { id: 'v2', name: '整箱', sku: 'case' },
            },
        });
        expect(detail?.packaging).not.toHaveProperty('unrelatedPrivateField');
        expect(h.assets.getEntityAssets).toHaveBeenCalledWith(h.ctx, h.product);
        expect(h.packaging.configForProduct).toHaveBeenCalledWith(h.ctx, 'p1');
    });

    it('never publishes disabled products or accepts authenticated/personalized snapshot contexts', async () => {
        const h = harness();
        for (const context of [
            { ...h.ctx, apiType: 'admin' },
            { ...h.ctx, activeUserId: 'admin' },
            { ...h.ctx, session: { activeOrderId: 'cart' } },
        ]) {
            await expect(h.service.list(context)).rejects.toThrow('公开商品快照');
        }
        expect(h.products.findAll).not.toHaveBeenCalled();
        h.product.enabled = false;
        expect(await h.service.byId(h.ctx, 'p1')).toBeNull();
        expect(await h.service.detail(h.ctx, 'p1')).toBeNull();
        expect(await h.service.project(h.ctx, [h.product as any])).toEqual([]);
        expect(h.assets.getEntityAssets).not.toHaveBeenCalled();
    });

    it('keeps a price validation failure as a failure instead of publishing an invented zero price', async () => {
        const h = harness();
        h.variants.hydratePriceFields.mockRejectedValue(new Error('no channel price'));
        await expect(h.service.list(h.ctx)).rejects.toThrow('no channel price');
    });
});
