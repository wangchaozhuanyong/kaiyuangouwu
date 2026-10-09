// organize-imports-ignore -- Preserve ESLint ordering between Node imports and Vitest.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import {
    isStorefrontVisualPresetId,
    normalizeStorefrontVisualPreset,
} from '../../storefront-content-plugin/src/visual-presets';

import { storefrontRealtimeQueryMatches, type StorefrontRealtimeEvent } from './realtime-updates';
import { applyStorefrontVisualPreset, readStorefrontPreviewPreset } from './use-storefront-visual-preset';

describe('storefront visual preset lifecycle', () => {
    it('removes the previous skin when switching back to classic or unmounting', () => {
        const root = { dataset: {} } as HTMLElement;
        const dispose = applyStorefrontVisualPreset(root, 'neo-minimalist');
        expect(root.dataset.storefrontPreset).toBe('neo-minimalist');
        dispose();
        expect(root.dataset.storefrontPreset).toBeUndefined();
        applyStorefrontVisualPreset(root, 'classic');
        expect(root.dataset.storefrontPreset).toBe('classic');
        expect(normalizeStorefrontVisualPreset('invalid')).toBe('classic');
    });

    it('rejects the removed skin and falls back for old configuration and preview URLs', () => {
        expect(isStorefrontVisualPresetId('unsupported-preset')).toBe(false);
        const root = { dataset: {} } as HTMLElement;
        applyStorefrontVisualPreset(root, 'unsupported-preset');
        expect(root.dataset.storefrontPreset).toBe('classic');
        expect(
            readStorefrontPreviewPreset(
                '?storefrontPreviewEmbedded=1&storefrontPreviewPreset=unsupported-preset',
            ),
        ).toBeNull();
    });

    it.each(['sessionStorage', 'localStorage'])(
        'rejects unsupported cached skins and restores valid %s themes before the app loads',
        storage => {
            const script = readFileSync(
                new URL('../public/storefront/restore-theme.js', import.meta.url),
                'utf8',
            );
            for (const [cached, expected] of [
                ['unsupported-preset', 'classic'],
                ['classic', 'classic'],
                ['neo-minimalist', 'neo-minimalist'],
            ]) {
                const attributes: Record<string, string> = { 'data-storefront-preset': 'classic' };
                const properties: Record<string, string> = {};
                const origin = 'https://store.example.test';
                const payload = JSON.stringify({
                    version: 3,
                    origin,
                    channelCode: 'skin-test-store',
                    savedAt: Date.now(),
                    presetId: cached,
                    colors: { '--bg': '#ffffff', '--text': '#111827' },
                });
                runInNewContext(script, {
                    URLSearchParams,
                    location: { origin, host: 'store.example.test', pathname: '/', search: '' },
                    window: {
                        sessionStorage: {
                            getItem: (key: string) =>
                                storage === 'sessionStorage' && key === '__storefront_theme_v3__'
                                    ? payload
                                    : null,
                        },
                        localStorage: {
                            getItem: (key: string) =>
                                storage === 'localStorage' && key === '__storefront_theme_v3__'
                                    ? payload
                                    : null,
                        },
                    },
                    document: {
                        cookie: '',
                        getElementById: () => ({
                            textContent: JSON.stringify({
                                schemaVersion: 1,
                                scope: {
                                    host: 'store.example.test',
                                    priceContext: 'public',
                                    channelCode: 'skin-test-store',
                                    languageCode: 'zh_Hans',
                                    currencyCode: 'MYR',
                                },
                                config: { code: 'skin-test-store', accessMode: 'LIVE' },
                                route: '/',
                                generatedAt: Date.now(),
                            }),
                        }),
                        querySelector: () => ({ content: '' }),
                        documentElement: {
                            style: {
                                setProperty: (name: string, value: string) => {
                                    properties[name] = value;
                                },
                            },
                            removeAttribute: (name: string) => {
                                delete attributes[name];
                            },
                            setAttribute: (name: string, value: string) => {
                                attributes[name] = value;
                            },
                        },
                    },
                });
                expect(attributes['data-storefront-preset']).toBe(expected);
                expect(attributes['data-storefront-theme-channel']).toBe(
                    cached === 'unsupported-preset' ? undefined : 'skin-test-store',
                );
                expect(properties['--bg']).toBe(cached === 'unsupported-preset' ? undefined : '#ffffff');
            }
        },
    );

    it('invalidates only the active store skin after a content event', () => {
        const event: StorefrontRealtimeEvent = {
            version: 1,
            id: '1',
            occurredAt: new Date().toISOString(),
            topics: ['content'],
        };
        const scope = { marketCode: 'a:MYR', languageCode: 'zh_Hans' };
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: ['storefront', 'a:MYR', 'zh_Hans', 'visual-preset'] },
                event,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: ['storefront', 'b:CNY', 'zh_Hans', 'visual-preset'] },
                event,
                scope,
            ),
        ).toBe(false);
    });

    it('accepts a draft skin only inside the explicit embedded preview context', () => {
        expect(readStorefrontPreviewPreset('?storefrontPreviewPreset=neo-minimalist')).toBeNull();
        expect(
            readStorefrontPreviewPreset(
                '?storefrontPreviewEmbedded=1&storefrontPreviewPreset=neo-minimalist',
            ),
        ).toBe('neo-minimalist');
        expect(
            readStorefrontPreviewPreset('?storefrontPreviewEmbedded=1&storefrontPreviewPreset=invalid'),
        ).toBeNull();
    });
});
