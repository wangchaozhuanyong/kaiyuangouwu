import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { type MarketConfig } from './types';

const market: MarketConfig = {
    code: 'skin-test-store',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: '皮肤测试店铺',
};

afterEach(() => vi.unstubAllGlobals());

describe('visual preset Shop API compatibility', () => {
    it('reads the active store selection and falls back for unknown preset versions', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: {
                        storefrontVisualPreset: {
                            channelId: 'store-a',
                            presetId: 'future-skin',
                            revision: '1',
                        },
                    },
                }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);
        await expect(new ShopApi(market).storefrontVisualPreset()).resolves.toEqual({
            channelId: 'store-a',
            presetId: 'classic',
            revision: '1',
        });
        expect(fetchMock.mock.calls[0][1].headers['vendure-token']).toBe(market.code);
    });

    it('keeps the existing appearance when a rolling release reaches an older API', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        errors: [{ message: 'Cannot query field "storefrontVisualPreset" on type "Query".' }],
                    }),
                ),
            ),
        );
        await expect(new ShopApi(market).storefrontVisualPreset()).resolves.toMatchObject({
            presetId: 'classic',
        });
    });

    it('surfaces a server failure instead of treating it as a saved default selection', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        errors: [{ message: 'Temporary database failure' }],
                    }),
                ),
            ),
        );
        await expect(new ShopApi(market).storefrontVisualPreset()).rejects.toThrow(
            'Temporary database failure',
        );
    });
});
