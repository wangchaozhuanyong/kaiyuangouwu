// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
} from '../../storefront-content-plugin/src/shared/storefront-semantic-palette';

import { type ShopApi } from './api';
import { useStorefrontBrandColors } from './hooks/useStorefrontDocument';
import { STOREFRONT_CONFIG_REFRESH_INTERVAL } from './query-client';
import { cacheStorefrontTheme } from './storefront-theme-cache';
import { type MarketConfig, type StorefrontConfig } from './types';
import { useStorefrontVisualPreset } from './use-storefront-visual-preset';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalUrl = window.location.href;
afterEach(() => {
    window.history.replaceState(null, '', originalUrl);
    delete document.documentElement.dataset.storefrontPreset;
    delete document.documentElement.dataset.storefrontThemeChannel;
    document.documentElement.removeAttribute('style');
    sessionStorage.clear();
    localStorage.clear();
});

describe('embedded storefront skin', () => {
    it('keeps the selected preview skin after internal navigation removes URL parameters', () => {
        window.history.replaceState(
            null,
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewPreset=modern-oriental',
        );
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const queryClient = new QueryClient();
        const readPublishedSkin = vi.fn();
        const api = { storefrontVisualPreset: readPublishedSkin } as unknown as Pick<
            ShopApi,
            'storefrontVisualPreset'
        >;
        const market = { code: 'test:MYR' } as MarketConfig;
        function Probe() {
            useStorefrontVisualPreset(api, market, 'zh_Hans');
            return null;
        }
        try {
            act(() =>
                root.render(
                    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
                ),
            );
            expect(document.documentElement.dataset.storefrontPreset).toBe('modern-oriental');
            window.history.replaceState(null, '', '/category');
            act(() =>
                root.render(
                    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
                ),
            );
            expect(document.documentElement.dataset.storefrontPreset).toBe('modern-oriental');
            expect(readPublishedSkin).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
            queryClient.clear();
            host.remove();
        }
    });
});

it('updates an already visible guest skin from the saved store configuration', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const root = createRoot(host);
    const client = new QueryClient();
    let presetId = 'modern-oriental';
    const api = { storefrontVisualPreset: vi.fn(() => Promise.resolve({ presetId })) } as unknown as Pick<
        ShopApi,
        'storefrontVisualPreset'
    >;
    function Probe() {
        useStorefrontVisualPreset(api, { code: 'test:MYR' } as MarketConfig, 'zh_Hans');
        return null;
    }
    try {
        act(() => {
            root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(document.documentElement.dataset.storefrontPreset).toBe('modern-oriental');
        presetId = 'neo-minimalist';
        await act(async () => {
            await vi.advanceTimersByTimeAsync(STOREFRONT_CONFIG_REFRESH_INTERVAL);
        });
        expect(document.documentElement.dataset.storefrontPreset).toBe('neo-minimalist');
    } finally {
        act(() => root.unmount());
        client.clear();
        vi.useRealTimers();
    }
});

const restoreScript = readFileSync(path.join(__dirname, '../public/storefront/restore-theme.js'), 'utf8');
function restoreBeforePaint() {
    document.head.innerHTML = '<meta name="theme-color"><meta name="color-scheme">';
    document.documentElement.setAttribute('data-storefront-theme-pending', '');
    runInNewContext(restoreScript, { window, document, location: window.location, URLSearchParams, Date });
}

it.each(['classic', 'modern-oriental', 'neo-minimalist'] as const)(
    'keeps the complete %s palette across prepaint, context resolution and a delayed skin response',
    async presetId => {
        const colors = semanticPaletteCssVariables(
            resolveStorefrontSemanticPalette(presetId, { primaryColor: '#123456' }),
        );
        cacheStorefrontTheme('my-malaysia', presetId, colors);
        restoreBeforePaint();
        const palette = () =>
            Object.fromEntries(
                Object.keys(colors).map(name => [
                    name,
                    document.documentElement.style.getPropertyValue(name),
                ]),
            );
        expect(palette()).toEqual(colors);
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(false);
        let resolve!: (value: { presetId: string }) => void;
        const api = {
            storefrontVisualPreset: vi.fn(
                () =>
                    new Promise<{ presetId: string }>(done => {
                        resolve = done;
                    }),
            ),
        };
        const client = new QueryClient();
        const root = createRoot(document.createElement('div'));
        function Probe({ enabled }: { enabled: boolean }) {
            const visual = useStorefrontVisualPreset(
                api as unknown as Pick<ShopApi, 'storefrontVisualPreset'>,
                { code: 'my-malaysia' } as MarketConfig,
                'zh_Hans',
                enabled,
            );
            useStorefrontBrandColors(
                enabled
                    ? ({ code: 'my-malaysia', brandPrimaryColor: '#123456' } as StorefrontConfig)
                    : undefined,
                visual.presetId,
                { ready: enabled && visual.ready, cache: visual.cache },
            );
            return null;
        }
        const render = (enabled: boolean) =>
            act(() =>
                root.render(
                    createElement(QueryClientProvider, { client }, createElement(Probe, { enabled })),
                ),
            );
        try {
            render(false);
            expect(palette()).toEqual(colors);
            render(true);
            expect(palette()).toEqual(colors);
            await act(async () => {
                resolve({ presetId });
                await new Promise(done => setTimeout(done, 10));
            });
            expect(palette()).toEqual(colors);
            expect(document.documentElement.dataset.storefrontPreset).toBe(presetId);
        } finally {
            act(() => root.unmount());
            client.clear();
        }
        document.documentElement.removeAttribute('style');
        delete document.documentElement.dataset.storefrontPreset;
        delete document.documentElement.dataset.storefrontThemeChannel;
        restoreBeforePaint();
        expect(palette()).toEqual(colors);
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(false);
    },
);

it('rejects expired, foreign-origin or unsafe colors and never restores client colors into Admin preview', () => {
    const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('neo-minimalist'));
    cacheStorefrontTheme('my-malaysia', 'neo-minimalist', colors);
    const valid = JSON.parse(localStorage.getItem('__storefront_theme_v1__') ?? 'null');
    for (const invalid of [
        { ...valid, savedAt: Date.now() - 8 * 86400000 },
        { ...valid, origin: 'https://other-store.example' },
        { ...valid, colors: { ...colors, '--bg': 'url(https://other-store.example)' } },
    ]) {
        sessionStorage.setItem('__storefront_theme_v1__', JSON.stringify(invalid));
        localStorage.setItem('__storefront_theme_v1__', JSON.stringify(invalid));
        restoreBeforePaint();
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(true);
    }
    cacheStorefrontTheme('my-malaysia', 'neo-minimalist', colors);
    window.history.replaceState(null, '', '/?storefrontPreviewEmbedded=1');
    restoreBeforePaint();
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
});

it('does not adopt another verified channel skin while loading the active channel', () => {
    document.documentElement.dataset.storefrontPreset = 'neo-minimalist';
    document.documentElement.dataset.storefrontThemeChannel = 'other-store';
    const client = new QueryClient();
    const root = createRoot(document.createElement('div'));
    let visual!: ReturnType<typeof useStorefrontVisualPreset>;
    function Probe() {
        visual = useStorefrontVisualPreset(
            {
                storefrontVisualPreset: () =>
                    new Promise(resolve => {
                        void resolve;
                    }),
            },
            { code: 'my-malaysia' } as MarketConfig,
            'zh_Hans',
        );
        return null;
    }
    try {
        act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
        expect(visual.presetId).toBe('classic');
        expect(visual.ready).toBe(false);
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

it('reveals the cold-load fallback after a skin request fails instead of leaving the page hidden', async () => {
    document.documentElement.setAttribute('data-storefront-theme-pending', '');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(document.createElement('div'));
    let reject!: (error: Error) => void;
    const api = {
        storefrontVisualPreset: () =>
            new Promise<never>((_, fail) => {
                reject = fail;
            }),
    };
    function Probe() {
        const visual = useStorefrontVisualPreset(api, { code: 'my-malaysia' } as MarketConfig, 'zh_Hans');
        useStorefrontBrandColors({ code: 'my-malaysia' } as StorefrontConfig, visual.presetId, {
            ready: visual.ready,
            cache: visual.cache,
        });
        return null;
    }
    try {
        act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(true);
        await act(async () => {
            reject(new Error('offline'));
            await new Promise(done => setTimeout(done, 10));
        });
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f1f5f9');
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});
