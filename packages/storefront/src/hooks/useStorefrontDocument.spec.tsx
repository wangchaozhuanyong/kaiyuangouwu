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
    ready = true,
}: {
    logo: string | null;
    product?: Product;
    background?: string;
    primary?: string;
    presetId?: StorefrontVisualPresetId;
    route?: RouteState;
    ready?: boolean;
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
        brandingReady: ready,
    });
    return null;
}
afterEach(() => {
    document.head.innerHTML = '';
    window.history.replaceState({}, '', '/');
    sessionStorage.clear();
});
describe('runtime channel branding', () => {
    it('uses the selected skin palette across late branding responses and skin switches', () => {
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
            expect(color('--accent')).toBe('#292d32');
            expect(color('--skin-account-surface')).toBe('#f5eee3');
            expect(color('--skin-referral-surface')).toBe('#eef3ee');
            expect(color('--skin-coupon-tint')).toBe('#fff2e8');
            expect(color('--skin-tool-security-foreground')).toBe('#1d4ed8');

            act(() => root.render(<Fixture logo={null} background="#F5F7FB" presetId="neo-minimalist" />));
            // Read actual CSS without Vite's CSS transform so this also checks the palette contract.
            const style = document.createElement('style');
            style.textContent = presetStyles;
            document.head.append(style);
            expect(color('--bg')).toBe('#070b14');
            expect(color('--accent')).toBe('#6654c8');
            expect(color('--accent-hover')).toBe('#5745b6');
            expect(color('--accent-ink')).toBe('#c4b5fd');
            expect(color('--accent-foreground')).toBe('#ffffff');
            expect(color('--store-primary')).toBe('#8b5cf6');
            expect(color('--store-background')).toBe('#070b14');
            expect(color('--auth-store-background')).toBe('#070b14');
            expect(color('--brand-primary')).toBe('#8b5cf6');
            expect(color('--brand-background')).toBe('#070b14');
            expect(color('--skin-account-surface')).toBe('#6654c8');
            expect(color('--skin-referral-surface')).toBe('#6654c8');
            expect(color('--skin-coupon-tint')).toBe('initial');
            expect(color('color-scheme')).toBe('dark');
            expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
                '#070b14',
            );

            // A late branding response or another store must not cover the active skin.
            act(() => root.render(<Fixture logo={null} background="#070B14" presetId="neo-minimalist" />));
            expect(color('--bg')).toBe('#070b14');
            expect(color('--accent')).toBe('#6654c8');
            expect(color('--brand-background')).toBe('#070b14');

            act(() => root.render(<Fixture logo={null} background="#070B14" />));
            expect(color('--bg')).toBe('#f1f5f9');
            expect(color('--accent')).toBe('#292d32');
            expect(color('--skin-account-surface')).toBe('#f5eee3');
            expect(color('--skin-referral-surface')).toBe('#eef3ee');
            expect(color('--skin-coupon-tint')).toBe('#fff2e8');
            expect(color('--skin-tool-security-foreground')).toBe('#1d4ed8');
            expect(color('--accent-hover')).toBe('#161a1e');
            expect(color('--store-primary')).toBe('#292d32');
            expect(color('--auth-store-background')).toBe('#f1f5f9');

            act(() => root.render(<Fixture logo={null} presetId="neo-minimalist" />));
            expect(color('color-scheme')).toBe('dark');
            expect(color('--skin-tool-security-foreground')).toBe('#93c5fd');
            expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
                '#070b14',
            );
            expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('dark');

            act(() => root.render(<Fixture logo={null} />));
            expect(html.style.getPropertyValue('--bg')).toBe('#f1f5f9');
            expect(html.style.getPropertyValue('--accent')).toBe('#292d32');
            expect(html.style.getPropertyValue('--brand-background')).toBe('#f1f5f9');
        } finally {
            act(() => root.unmount());
        }
        expect(html.dataset.storefrontPreset).toBeUndefined();
        expect(html.style.getPropertyValue('--store-background')).toBe('');
    });

    it('updates merchant images while keeping classic controls identical across stores', () => {
        document.head.innerHTML = [
            '<meta property="og:image" content="/moyao.jpg">',
            '<meta name="twitter:image" content="/moyao.jpg">',
            '<link rel="icon" href="/moyao.jpg">',
            '<link rel="apple-touch-icon" href="/moyao.jpg">',
        ].join('');
        const root = createRoot(host);
        act(() => root.render(<Fixture logo="/store-a.png" background="#abcdef" primary="#123456" />));
        expect(document.documentElement.style.getPropertyValue('--store-background')).toBe('#f1f5f9');
        expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#292d32');
        act(() => root.render(<Fixture logo="/store-b.png" background="#fedcba" primary="#654321" />));
        expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#292d32');
        expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain(
            '/store-b.png',
        );
        expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
            '/store-b.png?storefront-icon=2&iv=3',
        );
        const migratedLogo = '/assets/preview/6e/store-icon__preview__webp_migrated_502.webp';
        act(() => root.render(<Fixture logo={migratedLogo} />));
        expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
            `${migratedLogo}?v=webp-readable-1&preset=storefront-icon-96&format=png&q=82&storefront-icon=2&iv=3`,
        );
        expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
            `${migratedLogo}?v=webp-readable-1&preset=storefront-thumbnail-fit-320&format=png&q=82&storefront-icon=2&iv=3`,
        );
        act(() => root.render(<Fixture logo={null} />));
        expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain(
            '/storefront/neutral-social.png',
        );
        expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
            '/storefront/neutral-store.png?storefront-icon=2&iv=3',
        );
        expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
            '/storefront/neutral-store.png?storefront-icon=2&iv=3',
        );
        expect(document.documentElement.style.getPropertyValue('--store-background')).toBe('#f1f5f9');
        expect(document.title).not.toContain('MOYAO');
        act(() => root.unmount());
    });

    it('preserves server branding while configuration is loading or only restored from cache', () => {
        document.head.innerHTML = '<link rel="icon" href="/fresh-server.png" data-storefront-icon="server">';
        const root = createRoot(host);
        try {
            act(() => root.render(<Fixture logo={null} ready={false} />));
            expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
                '/fresh-server.png',
            );
            act(() => root.render(<Fixture logo="/cached-store.png" ready={false} />));
            expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
                '/fresh-server.png',
            );
            act(() => root.render(<Fixture logo="/current-store.png" />));
            expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
                '/current-store.png?storefront-icon=2&iv=3',
            );
            expect(document.querySelector('link[rel="apple-touch-icon"]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
        }
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
