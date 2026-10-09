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
    storefrontSkinCssVariables,
} from '../../storefront-content-plugin/src/shared/storefront-semantic-palette';

import { type ShopApi } from './api';
import { useStorefrontBrandColors } from './hooks/useStorefrontDocument';
import { STOREFRONT_CONFIG_REFRESH_INTERVAL, storefrontQueryKeys } from './query-client';
import { cacheStorefrontTheme, restoredStorefrontTheme } from './storefront-theme-cache';
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
            '/?storefrontPreviewEmbedded=1&storefrontPreviewPreset=neo-minimalist',
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
            expect(document.documentElement.dataset.storefrontPreset).toBe('neo-minimalist');
            window.history.replaceState(null, '', '/category');
            act(() =>
                root.render(
                    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
                ),
            );
            expect(document.documentElement.dataset.storefrontPreset).toBe('neo-minimalist');
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
    let presetId = 'neo-minimalist';
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
        expect(document.documentElement.dataset.storefrontPreset).toBe('neo-minimalist');
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
const skinStyles = readFileSync(path.join(__dirname, './styles/visual-presets.css'), 'utf8');
function publicSnapshot() {
    return {
        schemaVersion: 1,
        generatedAt: Date.now(),
        route: window.location.pathname,
        scope: {
            host: window.location.host,
            channelCode: 'my-malaysia',
            languageCode: 'zh_Hans',
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        config: { code: 'my-malaysia', accessMode: 'LIVE' },
    };
}
function restoreBeforePaint(snapshot: unknown = publicSnapshot()) {
    document.head.innerHTML = '<meta name="theme-color"><meta name="color-scheme">';
    if (snapshot !== null) {
        const script = document.createElement('script');
        script.id = 'storefront-public-page-data';
        script.type = 'application/json';
        script.textContent = JSON.stringify(snapshot);
        document.head.append(script);
    }
    document.documentElement.setAttribute('data-storefront-theme-pending', '');
    runInNewContext(restoreScript, { window, document, location: window.location, URLSearchParams, Date });
    const style = document.createElement('style');
    style.textContent = skinStyles;
    document.head.append(style);
}

it('preserves same-store theme restoration on category pages with filters', () => {
    window.history.replaceState(null, '', '/category?sort=price');
    const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('neo-minimalist'));
    cacheStorefrontTheme('my-malaysia', 'neo-minimalist', colors);
    restoreBeforePaint({ ...publicSnapshot(), route: '/category?sort=price' });
    expect(document.documentElement.dataset.storefrontPreset).toBe('neo-minimalist');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe(colors['--bg']);
});

it.each(['classic', 'neo-minimalist'] as const)(
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
        const assertClassicModuleColors = () => {
            if (presetId !== 'classic') return;
            const style = getComputedStyle(document.documentElement);
            // The prepaint cache intentionally excludes module colors. Their shared CSS
            // fallback must already match runtime, even before a delayed skin request resolves.
            for (const [name, value] of Object.entries(storefrontSkinCssVariables('classic'))) {
                if (/^--(?:skin-(?:account|referral|coupon)-|navigation-)/.test(name)) {
                    expect(style.getPropertyValue(name).trim(), name).toBe(value);
                }
            }
        };
        expect(palette()).toEqual(colors);
        assertClassicModuleColors();
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
            assertClassicModuleColors();
            render(true);
            expect(palette()).toEqual(colors);
            assertClassicModuleColors();
            await act(async () => {
                resolve({ presetId });
                await new Promise(done => setTimeout(done, 10));
            });
            expect(palette()).toEqual(colors);
            assertClassicModuleColors();
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
        assertClassicModuleColors();
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(false);
    },
);

it.each(['sessionStorage', 'localStorage'] as const)(
    'ignores old merchant-colored themes in %s and accepts the new skin cache without deleting other data',
    storageName => {
        const legacy = JSON.stringify({
            version: 1,
            origin: window.location.origin,
            savedAt: Date.now(),
            channelCode: 'my-malaysia',
            presetId: 'classic',
            colors: { '--bg': '#f1f5f9', '--text': '#0f172a', '--accent': '#8f7029' },
        });
        const storage = window[storageName];
        storage.setItem('__storefront_theme_v1__', legacy);
        storage.setItem('unrelated-setting', 'preserved');
        restoreBeforePaint();
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
        expect(document.documentElement.dataset.storefrontThemeChannel).toBeUndefined();
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(true);

        const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('classic'));
        cacheStorefrontTheme('my-malaysia', 'classic', colors);
        expect(JSON.parse(storage.getItem('__storefront_theme_v3__') ?? 'null').version).toBe(3);
        restoreBeforePaint();
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe(colors['--accent']);
        expect(document.documentElement.dataset.storefrontThemeChannel).toBe('my-malaysia');
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(false);
        expect(storage.getItem('__storefront_theme_v1__')).toBe(legacy);
        expect(storage.getItem('unrelated-setting')).toBe('preserved');
    },
);

it.each([
    ['sessionStorage', 'classic'],
    ['localStorage', 'classic'],
    ['sessionStorage', 'neo-minimalist'],
    ['localStorage', 'neo-minimalist'],
] as const)(
    'preserves the v2 %s %s skin choice and background without restoring obsolete colors',
    (storageName, presetId) => {
        const legacy = JSON.stringify({
            version: 2,
            origin: window.location.origin,
            savedAt: Date.now(),
            channelCode: 'my-malaysia',
            presetId,
            colors: { '--bg': '#123456', '--text': '#0f172a', '--accent': '#2563eb' },
        });
        const storage = window[storageName];
        storage.setItem('__storefront_theme_v2__', legacy);
        storage.setItem('unrelated-setting', 'preserved');
        const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette(presetId));

        restoreBeforePaint();
        expect(restoredStorefrontTheme()).toEqual({ presetId, channelCode: 'my-malaysia' });
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe(colors['--bg']);
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
        expect(document.documentElement.style.getPropertyValue('--text')).toBe('');
        expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe(
            presetId === 'neo-minimalist' ? 'dark' : 'light',
        );
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(true);

        cacheStorefrontTheme('my-malaysia', presetId, colors);
        restoreBeforePaint();
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe(colors['--accent']);
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(false);
        expect(storage.getItem('__storefront_theme_v2__')).toBe(legacy);
        expect(storage.getItem('unrelated-setting')).toBe('preserved');
    },
);

it('rejects old versions, expired, foreign-origin or unsafe colors and never restores client colors into Admin preview', () => {
    const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('neo-minimalist'));
    cacheStorefrontTheme('my-malaysia', 'neo-minimalist', colors);
    const valid = JSON.parse(localStorage.getItem('__storefront_theme_v3__') ?? 'null');
    for (const invalid of [
        { ...valid, version: 1 },
        { ...valid, savedAt: Date.now() - 8 * 86400000 },
        { ...valid, origin: 'https://other-store.example' },
        { ...valid, colors: { ...colors, '--bg': 'url(https://other-store.example)' } },
    ]) {
        sessionStorage.setItem('__storefront_theme_v3__', JSON.stringify(invalid));
        localStorage.setItem('__storefront_theme_v3__', JSON.stringify(invalid));
        restoreBeforePaint();
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
        expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(true);
    }
    cacheStorefrontTheme('my-malaysia', 'neo-minimalist', colors);
    window.history.replaceState(null, '', '/?storefrontPreviewEmbedded=1');
    restoreBeforePaint();
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
});

it('falls back to a valid local v3 palette when the session cache has unsafe colors', () => {
    const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('classic'));
    cacheStorefrontTheme('my-malaysia', 'classic', colors);
    const sessionTheme = JSON.parse(sessionStorage.getItem('__storefront_theme_v3__') ?? 'null');
    sessionStorage.setItem(
        '__storefront_theme_v3__',
        JSON.stringify({ ...sessionTheme, colors: { ...colors, '--accent': 'url(https://example.test)' } }),
    );
    restoreBeforePaint();
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(colors['--accent']);
    expect(document.documentElement.hasAttribute('data-storefront-theme-pending')).toBe(false);
});

it('removes another channel restored CSS while loading the active channel without clearing unrelated styles', () => {
    document.documentElement.dataset.storefrontPreset = 'neo-minimalist';
    document.documentElement.dataset.storefrontThemeChannel = 'other-store';
    document.documentElement.style.setProperty('--bg', '#070b14');
    document.documentElement.style.setProperty('--accent', '#6654c8');
    document.documentElement.style.setProperty('--unrelated-offset', '32px');
    document.documentElement.style.setProperty('color-scheme', 'dark');
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
        expect(document.documentElement.dataset.storefrontPreset).toBeUndefined();
        expect(document.documentElement.dataset.storefrontThemeChannel).toBeUndefined();
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
        expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('');
        expect(document.documentElement.style.getPropertyValue('--unrelated-offset')).toBe('32px');
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

it('restores cached colors only after the fresh HTML confirms the same public store', () => {
    const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('neo-minimalist'));
    cacheStorefrontTheme('my-malaysia', 'neo-minimalist', colors);
    const valid = publicSnapshot();
    for (const snapshot of [
        null,
        {
            ...valid,
            scope: { ...valid.scope, channelCode: 'other-store' },
            config: { code: 'other-store', accessMode: 'LIVE' },
        },
        { ...valid, scope: { ...valid.scope, host: 'another-store.example' } },
        { ...valid, config: { ...valid.config, code: 'mismatched-store' } },
        { ...valid, config: { ...valid.config, accessMode: 'PREVIEW' } },
        { ...valid, config: { ...valid.config, accessMode: 'CLOSED' } },
        { ...valid, generatedAt: Date.now() - 31_000 },
        { ...valid, generatedAt: Date.now() + 6_000 },
        { ...valid, route: '/different-route' },
        { ...valid, visualPreset: { presetId: 'classic' } },
    ]) {
        restoreBeforePaint(snapshot);
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
        expect(document.documentElement.dataset.storefrontThemeChannel).toBeUndefined();
    }
    restoreBeforePaint(valid);
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe(colors['--bg']);
    expect(document.documentElement.dataset.storefrontThemeChannel).toBe('my-malaysia');
});

it('does not actively apply or persist cached query or restored skin while identity is unresolved', () => {
    document.documentElement.dataset.storefrontPreset = 'neo-minimalist';
    document.documentElement.dataset.storefrontThemeChannel = 'my-malaysia';
    const market = { code: 'my-malaysia', currencyCode: 'MYR' } as MarketConfig;
    const client = new QueryClient();
    client.setQueryData(
        [...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), 'zh_Hans'), 'visual-preset'],
        { presetId: 'neo-minimalist' },
    );
    const root = createRoot(document.createElement('div'));
    let visual!: ReturnType<typeof useStorefrontVisualPreset>;
    const api = { storefrontVisualPreset: vi.fn() } as unknown as Pick<ShopApi, 'storefrontVisualPreset'>;
    function Probe() {
        visual = useStorefrontVisualPreset(api, market, 'zh_Hans', false);
        return null;
    }
    try {
        act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
        expect(visual).toEqual({ presetId: 'classic', ready: false, cache: false });
        expect(api.storefrontVisualPreset).not.toHaveBeenCalled();
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

it('retires restored theme ownership on a same-document A to B to A switch', () => {
    const colors = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('neo-minimalist'));
    cacheStorefrontTheme('my-malaysia', 'neo-minimalist', colors);
    restoreBeforePaint();
    const client = new QueryClient();
    const root = createRoot(document.createElement('div'));
    let visual!: ReturnType<typeof useStorefrontVisualPreset>;
    const api = { storefrontVisualPreset: () => new Promise(() => undefined) } as unknown as Pick<
        ShopApi,
        'storefrontVisualPreset'
    >;
    function Probe({ code }: { code: string }) {
        visual = useStorefrontVisualPreset(api, { code, currencyCode: 'MYR' } as MarketConfig, 'zh_Hans');
        return null;
    }
    const render = (code: string) =>
        act(() =>
            root.render(createElement(QueryClientProvider, { client }, createElement(Probe, { code }))),
        );
    try {
        render('my-malaysia');
        expect(visual.presetId).toBe('neo-minimalist');
        expect(visual.ready).toBe(true);
        render('other-store');
        expect(visual.presetId).toBe('classic');
        expect(visual.ready).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
        render('my-malaysia');
        expect(visual.presetId).toBe('classic');
        expect(visual.ready).toBe(false);
        expect(document.documentElement.dataset.storefrontThemeChannel).toBeUndefined();
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});
