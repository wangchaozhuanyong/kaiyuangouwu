import 'reflect-metadata';

import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { ProductVariantEntityResolver } from '../../api/resolvers/entity/product-variant-entity.resolver';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { ensureConfigLoaded } from '../../config/config-helpers';
import { Channel } from '../../entity/channel/channel.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';

import { ProductVariantService } from './product-variant.service';

const zeroTax = new TaxRate({ value: 0 });

function harness() {
    const ctx = new RequestContext({
        apiType: 'shop',
        channel: new Channel({ id: 'channel-a', defaultCurrencyCode: CurrencyCode.MYR }),
        currencyCode: CurrencyCode.MYR,
        isAuthorized: false,
        authorizedAsOwnerOnly: false,
    });
    const applyChannelPriceAndTax = vi.fn((variant: ProductVariant, priceContext: RequestContext) => {
        const selected = variant.productVariantPrices.find(
            price =>
                price.channelId === priceContext.channelId &&
                price.currencyCode === priceContext.currencyCode,
        );
        if (!selected) return Promise.reject(new Error('No price in the active channel'));
        return Promise.resolve(
            Object.assign(variant, {
                listPrice: selected.price,
                listPriceIncludesTax: false,
                currencyCode: priceContext.currencyCode,
                taxRateApplied: zeroTax,
            }),
        );
    });
    const service = Object.assign(Object.create(ProductVariantService.prototype), {
        requestCache: new RequestContextCacheService(),
        applyChannelPriceAndTax,
        connection: { getEntityOrThrow: vi.fn() },
    }) as ProductVariantService;
    const resolver = new ProductVariantEntityResolver(service, {} as any, {} as any, {} as any);
    return { ctx, resolver, applyChannelPriceAndTax };
}

function pricedVariant(currencyCode: CurrencyCode, listPrice: number) {
    return new ProductVariant({
        id: 'shared-variant',
        listPrice,
        listPriceIncludesTax: false,
        currencyCode,
        taxRateApplied: zeroTax,
        taxCategory: { id: 'tax-category' },
        productVariantPrices: [
            { channelId: 'channel-a', price: 2000, currencyCode: CurrencyCode.MYR },
            {
                channelId: 'channel-a',
                price: currencyCode === CurrencyCode.CNY ? listPrice : 3277,
                currencyCode: CurrencyCode.CNY,
            },
        ],
    });
}

describe('GraphQL variant pricing snapshots', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    it('does not bypass current-channel price validation for a complete snapshot', async () => {
        const { ctx, resolver, applyChannelPriceAndTax } = harness();
        applyChannelPriceAndTax.mockRejectedValueOnce(new Error('No price in the active channel'));
        await expect(resolver.priceWithTax(ctx, pricedVariant(CurrencyCode.CNY, 3277))).rejects.toThrow(
            'No price in the active channel',
        );
    });

    it.each([3277, 0])(
        'preserves an eagerly priced order snapshot, including a zero price: %s',
        async price => {
            const { ctx, resolver, applyChannelPriceAndTax } = harness();
            const variant = pricedVariant(CurrencyCode.CNY, price);
            const fields = await Promise.all([
                resolver.price(ctx, variant),
                resolver.priceWithTax(ctx, variant),
                resolver.currencyCode(ctx, variant),
                resolver.taxRateApplied(ctx, variant),
            ]);
            expect(fields).toEqual([price, price, CurrencyCode.CNY, zeroTax]);
            expect(applyChannelPriceAndTax).toHaveBeenCalledExactlyOnceWith(
                variant,
                expect.objectContaining({ currencyCode: CurrencyCode.CNY }),
                undefined,
                true,
            );
        },
    );

    it('does not replace cart pricing with a catalog result cached for the same variant ID', async () => {
        const { ctx, resolver } = harness();
        const catalog = pricedVariant(CurrencyCode.MYR, 2000);
        catalog.listPrice = undefined as any;
        expect(await resolver.priceWithTax(ctx, catalog)).toBe(2000);
        const cart = pricedVariant(CurrencyCode.CNY, 3277);
        expect(await resolver.priceWithTax(ctx, cart)).toBe(3277);
        expect(await resolver.currencyCode(ctx, cart)).toBe(CurrencyCode.CNY);
    });

    it.each(['listPrice', 'listPriceIncludesTax', 'currencyCode', 'taxRateApplied'] as const)(
        'hydrates an incomplete snapshot in the request context when %s is absent',
        async field => {
            const { ctx, resolver, applyChannelPriceAndTax } = harness();
            const variant = pricedVariant(CurrencyCode.CNY, 3277);
            (variant as any)[field] = undefined;
            expect(await resolver.priceWithTax(ctx, variant)).toBe(2000);
            expect(await resolver.currencyCode(ctx, variant)).toBe(CurrencyCode.MYR);
            expect(applyChannelPriceAndTax).toHaveBeenCalledOnce();
        },
    );
});
