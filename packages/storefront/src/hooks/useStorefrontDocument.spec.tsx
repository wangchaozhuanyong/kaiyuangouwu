// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { type Product, type StorefrontConfig } from '../types';

import { useStorefrontBrandColors, useStorefrontMetadata } from './useStorefrontDocument';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement('div');
function Fixture({
    logo,
    product,
    background,
}: {
    logo: string | null;
    product?: Product;
    background?: string;
}) {
    useStorefrontBrandColors(
        background
            ? ({ brandBackgroundColor: background, brandPrimaryColor: '#234567' } as StorefrontConfig)
            : undefined,
    );
    useStorefrontMetadata({
        isZh: true,
        route: { name: product ? 'product' : 'home' },
        selectedProduct: product,
        storefrontDescription: '',
        storefrontName: logo ? '当前店铺' : '店铺',
        logoUrl: logo,
    });
    return null;
}
afterEach(() => {
    document.head.innerHTML = '';
    sessionStorage.clear();
});
describe('runtime channel branding', () => {
    it('replaces every image and clears the prior store colors when switching to a blank store', () => {
        document.head.innerHTML = [
            '<meta property="og:image" content="/moyao.jpg">',
            '<meta name="twitter:image" content="/moyao.jpg">',
            '<link rel="icon" href="/moyao.jpg">',
            '<link rel="apple-touch-icon" href="/moyao.jpg">',
        ].join('');
        const root = createRoot(host);
        act(() => root.render(<Fixture logo="/store-a.png" background="#abcdef" />));
        expect(document.documentElement.style.getPropertyValue('--store-background')).toBe('#abcdef');
        act(() => root.render(<Fixture logo="/store-b.png" background="#fedcba" />));
        expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain(
            '/store-b.png',
        );
        expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
            '/store-b.png',
        );
        act(() => root.render(<Fixture logo={null} />));
        expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain(
            '/storefront/neutral-social.png',
        );
        expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
            '/storefront/neutral-store.png',
        );
        expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
            '/storefront/neutral-store.png',
        );
        expect(document.documentElement.style.getPropertyValue('--store-background')).toBe('');
        expect(document.title).not.toContain('MOYAO');
        act(() => root.unmount());
    });
});
