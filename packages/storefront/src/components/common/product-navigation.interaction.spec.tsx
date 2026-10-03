// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontContext, type StorefrontContextValue } from '../../StorefrontContext';
import { type MarketConfig, type Product } from '../../types';

import { ProductCard } from './product-card';
import { ProductRow } from './product-row';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const product: Product = {
    id: 'product-1',
    name: '牡丹礼盒',
    slug: 'gift',
    description: '实物商品',
    createdAt: '2026-01-01T00:00:00.000Z',
    featuredAsset: { id: 'asset-1', preview: '/product.webp' },
    assets: [],
    collections: [],
    variants: [],
};
const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

describe('shared product navigation', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    const onOpen = vi.fn();
    const onFavorite = vi.fn();

    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.clearAllMocks();
    });

    function element<T extends Element = HTMLElement>(selector: string): T {
        const match = host.querySelector<T>(selector);
        if (!match) throw new Error(`Missing product target ${selector}`);
        return match;
    }

    function render(layout: 'card' | 'gallery' | 'mosaic' | 'row' | 'catalog', item = product) {
        const props = { product: item, market, language: 'zh' as const, locale: market.locale, onOpen };
        act(() =>
            root.render(
                layout === 'card' || layout === 'gallery' || layout === 'mosaic' ? (
                    <ProductCard {...props} appearance={layout} onFavorite={onFavorite} />
                ) : (
                    <ProductRow {...props} layout={layout} />
                ),
            ),
        );
        return element<HTMLAnchorElement>('a');
    }

    it.each(['card', 'gallery', 'mosaic', 'row', 'catalog'] as const)(
        '%s opens once from image, name, price and card space through the same real link',
        layout => {
            const link = render(layout);
            expect(link.getAttribute('href')).toBe('/product?id=product-1');
            for (const target of [
                element('img'),
                element('strong'),
                element('.product-card-price, .product-row-price'),
                link,
            ]) {
                expect(link.contains(target)).toBe(true);
                act(() => {
                    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                });
            }
            expect(onOpen).toHaveBeenCalledTimes(4);
            expect(onFavorite).not.toHaveBeenCalled();
        },
    );

    it.each(['gallery', 'mosaic'] as const)('keeps quote-only and sold-out states in %s', appearance => {
        render(appearance, {
            ...product,
            customFields: {
                fulfillmentType: 'physical',
                pricingMode: 'QUOTE_ONLY',
                refundPolicy: 'MERCHANT_REVIEW',
                manualDeliverySlaMinutes: 0,
            },
        });
        expect(element('.product-card-price').textContent).toContain('联系客服询价');
        expect(host.querySelector('.product-card-stock')).toBeNull();
        render(appearance);
        expect(element('.product-card-stock').textContent).toContain('已售罄');
        expect(host.querySelector('.product-card-meta')).toBeNull();
        expect(host.querySelector('.product-card-subtitle')).toBeNull();
    });

    it('keeps favorite independent from navigation', () => {
        const link = render('card');
        const favorite = element<HTMLButtonElement>('.product-card-favorite');
        expect(link.contains(favorite)).toBe(false);
        act(() => favorite.click());
        expect(onFavorite).toHaveBeenCalledOnce();
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('uses the shared product navigation when rendered inside the storefront', () => {
        const navigate = vi.fn();
        act(() =>
            root.render(
                <StorefrontContext.Provider value={{ navigate } as unknown as StorefrontContextValue}>
                    <ProductRow
                        product={product}
                        market={market}
                        language="zh"
                        locale={market.locale}
                        onOpen={onOpen}
                    />
                </StorefrontContext.Provider>,
            ),
        );
        act(() => {
            element<HTMLAnchorElement>('a').dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true }),
            );
        });
        expect(navigate).toHaveBeenCalledWith({ name: 'product', id: product.id });
        expect(onOpen).not.toHaveBeenCalled();
    });

    it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
        'preserves the native link gesture %j',
        gesture => {
            const link = render('card');
            let intercepted: boolean | undefined;
            // Observe React's decision, then suppress jsdom's unavailable browser navigation.
            const observe = (event: Event) => {
                intercepted = event.defaultPrevented;
                event.preventDefault();
            };
            document.addEventListener('click', observe, { once: true });
            act(() => {
                link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...gesture }));
            });
            expect(intercepted).toBe(false);
            expect(onOpen).not.toHaveBeenCalled();
        },
    );

    it('keeps image fallback content navigable and encodes product identifiers', () => {
        const link = render('card', { ...product, id: '商品 & 1', featuredAsset: null });
        expect(link.getAttribute('href')).toBe('/product?id=%E5%95%86%E5%93%81+%26+1');
        const media = element('.product-card-media');
        expect(link.contains(media)).toBe(true);
        act(() => {
            media.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(onOpen).toHaveBeenCalledOnce();
    });
});
