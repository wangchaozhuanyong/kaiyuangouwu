import 'reflect-metadata';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { CacheService } from '../../cache/cache.service';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Injector } from '../../common/injector';
import { MultiChannelStockLocationStrategy } from '../../config/catalog/multi-channel-stock-location-strategy';
import { Logger } from '../../config/logger/vendure-logger';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { EventBus } from '../../event-bus/event-bus';
import { StockLocationEvent } from '../../event-bus/events/stock-location-event';

import { CollectionService } from './collection.service';
import { ProductVariantService } from './product-variant.service';

const ctx = () =>
    ({ apiType: 'shop', channelId: 'A', languageCode: 'en', currencyCode: 'USD' }) as RequestContext;

describe('catalog display read batches', () => {
    it('handles an asynchronous stock-location cache invalidation failure without leaking a rejection', async () => {
        const events = new Subject<StockLocationEvent>();
        const deleteCache = vi.fn().mockRejectedValue(new Error('cache unavailable'));
        const createCache = vi.fn().mockReturnValue({ delete: deleteCache });
        const strategy = new MultiChannelStockLocationStrategy();
        const injector = {
            get: (token: unknown) => {
                if (token === EventBus) return { ofType: () => events };
                if (token === CacheService) return { createCache };
                if (token === RequestContextCacheService) return new RequestContextCacheService();
                return {};
            },
        } as Injector;
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        try {
            await strategy.init(injector);
            const location = new StockLocation({ id: 'location' });
            events.next(new StockLocationEvent(ctx(), location, 'created'));
            expect(deleteCache).not.toHaveBeenCalled();
            events.next(new StockLocationEvent(ctx(), location, 'updated'));
            await Promise.resolve();
            expect(deleteCache).toHaveBeenCalledExactlyOnceWith(
                'MultiChannelStockLocationStrategy:StockLocationChannelIds:location',
            );
            expect(warn).toHaveBeenCalledWith(
                'Failed to invalidate stock location channel cache',
                'MultiChannelStockLocationStrategy',
            );
        } finally {
            events.complete();
            warn.mockRestore();
        }
    });

    it.each([12, 48])(
        '%i products with 3 variants need one variant repository read and preserve prices',
        async size => {
            const rows = Array.from({ length: size }, (_, product) =>
                Array.from({ length: 3 }, (_entry, variant) => ({
                    id: `${product}-${variant}`,
                    productId: String(product),
                    listPrice: 0,
                })),
            ).flat();
            const getMany = vi.fn().mockResolvedValue(rows);
            const qb = {
                setFindOptions: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                getMany,
            };
            const apply = vi.fn((variant: ProductVariant) =>
                Promise.resolve({
                    ...variant,
                    listPrice: Number(String(variant.id).split('-')[0]) + 100,
                }),
            );
            const service = Object.assign(Object.create(ProductVariantService.prototype), {
                connection: { getRepository: () => ({ createQueryBuilder: () => qb }) },
                configService: { apiOptions: { shopListQueryLimit: 100, adminListQueryLimit: 1000 } },
                requestCache: new RequestContextCacheService(),
                applyChannelPriceAndTax: apply,
                translator: { translate: (value: unknown) => value },
            }) as ProductVariantService;
            const request = ctx();
            const result = await Promise.all(
                Array.from({ length: size }, (_, id) =>
                    service.getVariantsForProduct(request, id, ['featuredAsset']),
                ),
            );
            expect(getMany).toHaveBeenCalledTimes(1);
            expect(result.map(items => items.length)).toEqual(Array(size).fill(3));
            expect(result[11][2].listPrice).toBe(111);
            expect(apply).toHaveBeenCalledTimes(size * 3);
            expect(qb.setFindOptions).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        channels: { id: 'A' },
                        enabled: true,
                        productId: expect.anything(),
                        deletedAt: expect.anything(),
                    },
                    relations: ['featuredAsset', 'product', 'taxCategory'],
                    relationLoadStrategy: 'query',
                }),
            );
            expect(qb.setFindOptions.mock.calls[0][0]).not.toHaveProperty('order');
            expect(qb.orderBy).toHaveBeenCalledWith('productvariant.id', 'ASC');
            await service.getVariantsForProduct(request, 0, ['featuredAsset']);
            expect(getMany).toHaveBeenCalledTimes(1);
        },
    );

    it('keeps the variant limit per product and separates projections and channels', async () => {
        const getMany = vi.fn().mockResolvedValue([
            { id: 'a1', productId: 'a' },
            { id: 'a2', productId: 'a' },
            { id: 'a3', productId: 'a' },
            { id: 'b1', productId: 'b' },
            { id: 'b2', productId: 'b' },
        ]);
        const qb = {
            setFindOptions: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            getMany,
        };
        const service = Object.assign(Object.create(ProductVariantService.prototype), {
            connection: { getRepository: () => ({ createQueryBuilder: () => qb }) },
            configService: { apiOptions: { shopListQueryLimit: 2, adminListQueryLimit: 100 } },
            requestCache: new RequestContextCacheService(),
            applyChannelPriceAndTax: (value: unknown) => Promise.resolve(value),
            translator: { translate: (value: unknown) => value },
        }) as ProductVariantService;
        const request = ctx();
        const [a, b] = await Promise.all(
            ['a', 'b'].map(id => service.getVariantsForProduct(request, id, [])),
        );
        expect(a.map(row => row.id)).toEqual(['a1', 'a2']);
        expect(b.map(row => row.id)).toEqual(['b1', 'b2']);
        await service.getVariantsForProduct(request, 'a', ['options']);
        await service.getVariantsForProduct({ ...request, channelId: 'B' } as RequestContext, 'a', []);
        expect(getMany).toHaveBeenCalledTimes(3);
        expect(qb.setFindOptions).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ where: expect.objectContaining({ channels: { id: 'B' } }) }),
        );
        expect(qb.setFindOptions).not.toHaveBeenCalledWith(
            expect.objectContaining({ take: expect.anything() }),
        );
        expect(qb.setFindOptions).not.toHaveBeenCalledWith(
            expect.objectContaining({ skip: expect.anything() }),
        );
    });

    it.each([12, 48])(
        '%i product collection fields use one query and preserve deduplication and privacy scope',
        async size => {
            const getRawAndEntities = vi.fn().mockResolvedValue({
                entities: [{ id: 'common', name: 'Shared' }],
                raw: Array.from({ length: size }, (_, id) => [
                    { productId: String(id), collection_id: 'common' },
                    { productId: String(id), collection_id: 'common' },
                ]).flat(),
            });
            const qb = {
                leftJoinAndSelect: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                addSelect: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                andWhere: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                getRawAndEntities,
            };
            const service = Object.assign(Object.create(CollectionService.prototype), {
                connection: { getRepository: () => ({ createQueryBuilder: () => qb }) },
                requestCache: new RequestContextCacheService(),
                translator: { translate: (value: unknown) => value },
            }) as CollectionService;
            const request = ctx();
            const result = await Promise.all(
                Array.from({ length: size }, (_, id) => service.getCollectionsByProductId(request, id, true)),
            );
            expect(getRawAndEntities).toHaveBeenCalledTimes(1);
            expect(result.every(items => items.length === 1 && items[0].id === 'common')).toBe(true);
            expect(qb.innerJoin).toHaveBeenCalledWith(
                'collection.channels',
                'channel',
                'channel.id = :channelId',
                { channelId: 'A' },
            );
            expect(qb.andWhere).toHaveBeenCalledWith('collection.isPrivate = :isPrivate', {
                isPrivate: false,
            });
        },
    );
});
