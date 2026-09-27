// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { type StorefrontVisualPresetId } from '../../../storefront-content-plugin/src/visual-presets';
import { type RouteState } from '../storefront-router';
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
    primary,
    presetId = 'classic',
    route,
}: {
    logo: string | null;
    product?: Product;
    background?: string;
    primary?: string;
    presetId?: StorefrontVisualPresetId;
    route?: RouteState;
}) {
    useLayoutEffect(() => applyStorefrontVisualPreset(document.documentElement, presetId), [presetId]);
    useStorefrontBrandColors(
        background
            ? ({
                  brandBackgroundColor: background,
                  brandPrimaryColor: primary ?? '#234567',
                  brandHighlightColor: '#F28C28',
              } as StorefrontConfig)
            : undefined,
        presetId,
    );
    useStorefrontMetadata({
        isZh: true,
        route: route ?? { name: product ? 'product' : 'home' },
        selectedProduct: product,
        storefrontDescription: '',
        storefrontName: logo ? '当前店铺' : '店铺',
        logoUrl: logo,
    });
    return null;
}
afterEach(() => {
    document.head.innerHTML = '';
    window.history.replaceState({}, '', '/');
    sessionStorage.clear();
});
describe('runtime channel branding', () => {
    it('uses the selected skin palette and restores branding when switching back to classic', () => {
        document.head.innerHTML = [
            '<style>:root { --bg: #f3f6fb; }</style>',
            '<meta name="theme-color" content="#f1f5f9">',
            '<meta name="color-scheme" content="light">',
        ].join('');
        const root = createRoot(host);
        const html = document.documentElement;
        const color = (property: string) => getComputedStyle(html).getPropertyValue(property).trim();
        try {
            act(() => root.render(<Fixture logo={null} background="#F5F7FB" />));
            expect(color('--bg')).toBe('#f1f5f9');
            expect(color('--accent')).toBe('#234567');

            act(() => root.render(<Fixture logo={null} background="#F5F7FB" presetId="modern-oriental" />));
            // Read actual CSS without Vite's CSS transform so this also checks the palette contract.
            const style = document.createElement('style');
            style.textContent = presetStyles;
            document.head.append(style);
            expect(color('--bg')).toBe('#f3f4f0');
            expect(color('--accent')).toBe('#b34431');
            expect(color('--accent-hover')).toBe('#923526');
            expect(color('--accent-ink')).toBe('#a33b2b');
            expect(color('--accent-foreground')).toBe('#ffffff');
            expect(color('--store-primary')).toBe('#9f3b30');
            expect(color('--store-background')).toBe('#f3f4f0');
            expect(color('--auth-store-background')).toBe('#f3f4f0');
            expect(color('--brand-primary')).toBe('#9f3b30');
            expect(color('--brand-background')).toBe('#f3f4f0');
            expect(color('color-scheme')).toBe('light');
            expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
                '#f3f4f0',
            );

            // A late branding response or another store must not cover the active skin.
            act(() => root.render(<Fixture logo={null} background="#070B14" presetId="modern-oriental" />));
            expect(color('--bg')).toBe('#f3f4f0');
            expect(color('--accent')).toBe('#b34431');
            expect(color('--brand-background')).toBe('#f3f4f0');

            act(() => root.render(<Fixture logo={null} background="#070B14" />));
            expect(color('--bg')).toBe('#f1f5f9');
            expect(color('--accent')).toBe('#234567');
            expect(color('--accent-hover')).toBe('#a9621c');
            expect(color('--store-primary')).toBe('#234567');
            expect(color('--auth-store-background')).toBe('#f1f5f9');

            act(() => root.render(<Fixture logo={null} presetId="neo-minimalist" />));
            expect(color('color-scheme')).toBe('dark');
            expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
                '#070b14',
            );
            expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('dark');

            act(() => root.render(<Fixture logo={null} />));
            expect(html.style.getPropertyValue('--bg')).toBe('#f1f5f9');
            expect(html.style.getPropertyValue('--accent')).toBe('#d33c30');
            expect(html.style.getPropertyValue('--brand-background')).toBe('#f1f5f9');
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
        act(() => root.render(<Fixture logo="/store-a.png" background="#abcdef" primary="#123456" />));
        expect(document.documentElement.style.getPropertyValue('--store-background')).toBe('#f1f5f9');
        expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#123456');
        act(() => root.render(<Fixture logo="/store-b.png" background="#fedcba" primary="#654321" />));
        expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#654321');
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
        expect(document.documentElement.style.getPropertyValue('--store-background')).toBe('#f1f5f9');
        expect(document.title).not.toContain('MOYAO');
        act(() => root.unmount());
    });

    it('removes sensitive parameters from metadata and prevents private routes from being indexed', () => {
        document.head.innerHTML = [
            '<meta name="robots" content="index, follow, max-image-preview:large">',
            '<meta property="og:url" content="/">',
            '<link rel="canonical" href="/">',
        ].join('');
        window.history.replaceState({}, '', '/reset-password?token=audit-secret');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <Fixture logo={null} route={{ name: 'reset-password', token: 'audit-secret' }} />,
                ),
            );
            const safeUrl = new URL('/reset-password', window.location.origin).href;
            expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
                'noindex, nofollow, noarchive',
            );
            expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(safeUrl);
            expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(safeUrl);
            expect(document.head.innerHTML).not.toContain('audit-secret');

            window.history.replaceState({}, '', '/product?id=6');
            act(() => root.render(<Fixture logo={null} route={{ name: 'product', id: '6' }} />));
            expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
                'noindex, nofollow, noarchive',
            );
            expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
                new URL('/product', window.location.origin).href,
            );
        } finally {
            act(() => root.unmount());
        }
    });
});
