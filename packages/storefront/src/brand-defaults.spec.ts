import { describe, expect, it } from 'vitest';
import type { Product } from './types';

import { storefrontShareImage } from './hooks/useStorefrontDocument';
import {
    NEUTRAL_STOREFRONT_IMAGE,
    NEUTRAL_STOREFRONT_SOCIAL_IMAGE,
    STOREFRONT_LOGO_IMAGE,
    STOREFRONT_WORDMARK_IMAGE,
} from './storefront-images';
import { DEFAULT_STOREFRONT_NAMES } from './storefront-utils';

describe('neutral store defaults', () => {
    it('keeps neutral public fallback names while retaining historical artwork', () => {
        expect(DEFAULT_STOREFRONT_NAMES).toEqual({ zh: '店铺', en: 'Store' });
        expect(STOREFRONT_LOGO_IMAGE).toMatch(/app-icon(?:-[a-zA-Z0-9_-]+)?\.webp$/u);
        expect(STOREFRONT_WORDMARK_IMAGE).toMatch(/logo-on-light(?:-[a-zA-Z0-9_-]+)?\.webp$/u);
        expect(NEUTRAL_STOREFRONT_SOCIAL_IMAGE).toBe('/storefront/neutral-social.png');
        expect(NEUTRAL_STOREFRONT_IMAGE).toBe('/storefront/neutral-store.png');
    });
});

describe('channel-specific share images', () => {
    const product = { featuredAsset: { id: 'p', preview: '/product.png' }, assets: [] } as unknown as Product;
    for (const logo of ['/moyao-logo.png', '/damatong-logo.png', null]) {
        it(`prefers product artwork and uses only the active logo (${logo})`, () => {
            expect(storefrontShareImage('product', product, logo)).toBe('/product.png');
            expect(storefrontShareImage('product', { ...product, featuredAsset: null }, logo)).toBe(
                logo || NEUTRAL_STOREFRONT_SOCIAL_IMAGE,
            );
            expect(storefrontShareImage('home', product, logo)).toBe(logo || NEUTRAL_STOREFRONT_SOCIAL_IMAGE);
        });
    }
});
