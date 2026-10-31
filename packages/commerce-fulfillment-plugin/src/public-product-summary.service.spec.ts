import { ProductVariant, RequestContextCacheService } from '@vendure/core';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
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
    const mediaVariants = vi.fn().mockResolvedValue([variant]);
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
        {
            getRepository: () => ({
                find: (options: { relations?: unknown }) =>
                    Array.isArray(options?.relations) && options.relations.includes('featuredAsset')
                        ? mediaVariants(options)
                        : Promise.resolve([]),
            }),
        } as any,
        new RequestContextCacheService(),
        {
            apiOptions: { shopListQueryLimit: 100 },
            assetOptions: {
                assetStorageStrategy: { toAbsoluteUrl: (_req: unknown, value: string) => `/assets/${value}` },
            },
        } as any,
        assets as any,
        packaging as any,
        locale as any,
    );
    const ctx = { apiType: 'shop', channelId: 'A', req: {} } as any;
    return { service, product, products, variants, assets, packaging, mediaVariants, ctx };
}

describe('public product summary adapter', () => {
    it('reads only authorized artwork without loading commerce summaries', async () => {
        const h = harness();
        h.mediaVariants.mockResolvedValue([
            { featuredAsset: { id: 'variant-image', preview: 'preview/variant.webp' } },
        ]);
        const fullSummary = vi
            .spyOn(h.service as any, 'summary')
            .mockRejectedValue(new Error('Artwork must not read stock, pricing or coupons'));
        expect(await h.service.mediaById(h.ctx, 'p1')).toEqual({
            id: 'p1',
            featuredAsset: { id: 'image', preview: '/assets/preview/image.webp' },
            variants: [
                {
                    featuredAsset: { id: 'variant-image', preview: '/assets/preview/variant.webp' },
                    product: { featuredAsset: { id: 'image', preview: '/assets/preview/image.webp' } },
                },
            ],
        });
        expect(fullSummary).not.toHaveBeenCalled();
        expect(h.variants.getVariantsForProduct).not.toHaveBeenCalled();
        expect(h.variants.hydratePriceFields).not.toHaveBeenCalled();
        expect(h.products.findOne).toHaveBeenCalledWith(h.ctx, 'p1', ['featuredAsset']);
        expect(h.mediaVariants).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    productId: 'p1',
                    enabled: true,
                    channels: { id: 'A' },
                }),
                relations: ['featuredAsset'],
                select: { id: true, featuredAsset: { id: true, preview: true } },
                loadEagerRelations: false,
                order: { id: 'ASC' },
                take: 100,
            }),
        );
    });

    it('keeps artwork reads anonymous and does not read variants for unavailable products', async () => {
        const h = harness();
        for (const context of [
            { ...h.ctx, apiType: 'admin' },
            { ...h.ctx, activeUserId: 'private' },
            { ...h.ctx, session: { activeOrderId: 'cart' } },
        ])
            await expect(h.service.mediaById(context, 'p1')).rejects.toThrow('公开商品快照');
        expect(h.products.findOne).not.toHaveBeenCalled();
        h.product.enabled = false;
        expect(await h.service.mediaById(h.ctx, 'p1')).toBeNull();
        expect(h.mediaVariants).not.toHaveBeenCalled();
        h.products.findOne.mockResolvedValue(undefined);
        expect(await h.service.mediaById(h.ctx, 'missing')).toBeNull();
        expect(h.mediaVariants).not.toHaveBeenCalled();
    });

    it('preserves every image used by the full summary projection, including variant-only covers', async () => {
        const h = harness();
        const variant = {
            id: 'v1',
            name: '规格',
            sku: 'sku',
            featuredAsset: { id: 'variant-cover', preview: 'preview/variant-only.webp' },
            customFields: { fulfillmentType: 'physical' },
            product: h.product,
        };
        (h.product as { featuredAsset: unknown }).featuredAsset = null;
        h.variants.getVariantsForProduct.mockResolvedValue([variant]);
        h.mediaVariants.mockResolvedValue([variant]);
        const summary = await h.service.byId(h.ctx, 'p1');
        const media = await h.service.mediaById(h.ctx, 'p1');
        expect(media).toEqual({
            id: summary?.id,
            featuredAsset: summary?.featuredAsset,
            variants: summary?.variants.map(item => ({
                featuredAsset: item.featuredAsset,
                product: { featuredAsset: item.product.featuredAsset },
            })),
        });
        expect(media?.variants[0].featuredAsset?.preview).toBe('/assets/preview/variant-only.webp');
    });

    it('filters channel, disabled and deleted variants in SQL while retaining the public order and limit', async () => {
        const asset = new EntitySchema({
            name: 'MediaAsset',
            columns: { id: { type: String, primary: true }, preview: { type: String } },
        });
        const channel = new EntitySchema({
            name: 'MediaChannel',
            columns: { id: { type: String, primary: true } },
        });
        const variant = new EntitySchema<Record<string, unknown>>({
            name: 'MediaVariant',
            columns: {
                id: { type: String, primary: true },
                productId: { type: String },
                enabled: { type: Boolean },
                deletedAt: { type: Date, nullable: true },
            },
            relations: {
                featuredAsset: { type: 'many-to-one', target: 'MediaAsset', joinColumn: true },
                channels: { type: 'many-to-many', target: 'MediaChannel', joinTable: true },
            },
        });
        const db = new DataSource({ type: 'sqljs', entities: [asset, channel, variant], synchronize: true });
        await db.initialize();
        try {
            await db.getRepository('MediaAsset').save({ id: 'v-image', preview: 'preview/v.webp' });
            await db.getRepository('MediaChannel').save([{ id: 'A' }, { id: 'B' }]);
            await db.getRepository('MediaVariant').save([
                { id: '1', productId: 'p1', enabled: true, channels: [{ id: 'A' }] },
                { id: '2', productId: 'p1', enabled: true, channels: [{ id: 'B' }] },
                { id: '3', productId: 'p1', enabled: false, channels: [{ id: 'A' }] },
                { id: '4', productId: 'p1', enabled: true, deletedAt: new Date(), channels: [{ id: 'A' }] },
                { id: '5', productId: 'other', enabled: true, channels: [{ id: 'A' }] },
                {
                    id: '6',
                    productId: 'p1',
                    enabled: true,
                    featuredAsset: { id: 'v-image' },
                    channels: [{ id: 'A' }],
                },
            ]);
            const h = harness();
            const connection = (h.service as any).connection;
            connection.getRepository = vi.fn((ctx, entity) => {
                expect(ctx).toBe(h.ctx);
                expect(entity).toBe(ProductVariant);
                return db.getRepository('MediaVariant');
            });
            const media = await h.service.mediaById(h.ctx, 'p1');
            expect(media?.variants.map(item => item.featuredAsset?.preview ?? null)).toEqual([
                null,
                '/assets/preview/v.webp',
            ]);
            (h.service as any).config.apiOptions.shopListQueryLimit = 1;
            expect((await h.service.mediaById(h.ctx, 'p1'))?.variants).toEqual([
                expect.objectContaining({ featuredAsset: null }),
            ]);
        } finally {
            await db.destroy();
        }
    });

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
