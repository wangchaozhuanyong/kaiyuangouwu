// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { type StorefrontVisualPresetId } from '../../../storefront-content-plugin/src/visual-presets';
import { type Product, type StorefrontConfig } from '../types';
import { applyStorefrontVisualPreset } from '../use-storefront-visual-preset';

import { useStorefrontBrandColors, useStorefrontMetadata } from './useStorefrontDocument';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement('div');
const presetStyles = readFileSync(path.join(__dirname, '../styles/visual-presets.css'), 'utf8');
function Fixture({
    logo,
    product,
    background,
    presetId = 'classic',
}: {
    logo: string | null;
    product?: Product;
    background?: string;
    presetId?: StorefrontVisualPresetId;
}) {
    useLayoutEffect(() => applyStorefrontVisualPreset(document.documentElement, presetId), [presetId]);
    useStorefrontBrandColors(
        background
            ? ({
                  brandBackgroundColor: background,
                  brandPrimaryColor: '#234567',
                  brandHighlightColor: '#F28C28',
              } as StorefrontConfig)
            : undefined,
        presetId,
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
    it('uses the selected skin palette and restores branding when switching back to classic', () => {
        document.head.innerHTML = '<style>:root { --bg: #f3f6fb; }</style>';
        const root = createRoot(host);
        const html = document.documentElement;
        const color = (property: string) => getComputedStyle(html).getPropertyValue(property).trim();
        try {
            act(() => root.render(<Fixture logo={null} background="#F5F7FB" />));
            expect(color('--bg')).toBe('#f3f6fb');
            expect(color('--accent')).toBe('#234567');

            act(() => root.render(<Fixture logo={null} background="#F5F7FB" presetId="modern-oriental" />));
            // Read actual CSS without Vite's CSS transform so this also checks the palette contract.
            const style = document.createElement('style');
            style.textContent = presetStyles;
            document.head.append(style);
            expect(color('--bg')).toBe('#f6f2ea');
            expect(color('--accent')).toBe('#a63d32');
            expect(color('--accent-hover')).toBe('#8b3027');
            expect(color('--accent-ink')).toBe('#94362b');
            expect(color('--accent-foreground')).toBe('#fffdf8');
            expect(color('--store-primary')).toBe('');
            expect(color('--store-background')).toBe('');
            expect(color('--auth-store-background')).toBe('');
            expect(color('--brand-primary')).toBe('#234567');
            expect(color('--brand-background')).toBe('#F5F7FB');

            // A late branding response or another store must not cover the active skin.
            act(() => root.render(<Fixture logo={null} background="#070B14" presetId="modern-oriental" />));
            expect(color('--bg')).toBe('#f6f2ea');
            expect(color('--accent')).toBe('#a63d32');
            expect(color('--brand-background')).toBe('#070B14');

            act(() => root.render(<Fixture logo={null} background="#070B14" />));
            expect(color('--bg')).toBe('#f3f6fb');
            expect(color('--accent')).toBe('#234567');
            expect(color('--accent-hover')).toBe('#F28C28');
            expect(color('--store-primary')).toBe('#234567');
            expect(color('--auth-store-background')).toBe('#070B14');

            act(() => root.render(<Fixture logo={null} />));
            expect(html.style.getPropertyValue('--bg')).toBe('');
            expect(html.style.getPropertyValue('--accent')).toBe('');
            expect(html.style.getPropertyValue('--brand-background')).toBe('');
        } finally {
            act(() => root.unmount());
        }
        expect(html.dataset.storefrontPreset).toBeUndefined();
        expect(html.style.getPropertyValue('--store-background')).toBe('');
    });

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
