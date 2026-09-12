// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enabledMarkets, marketForStorefrontConfig } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { scopedStorageKey } from '../storefront-storage';
import { FAVORITE_PRODUCT_STORAGE_KEY } from '../storefront-utils';
import { StorefrontConfig } from '../types';

import { useStorefrontBootstrap } from './useStorefrontBootstrap';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const queries = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./useStorefrontPublicData', () => ({ useStorefrontPublicData: queries.read }));

describe('storefront bootstrap boundaries', () => {
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    let value: ReturnType<typeof useStorefrontBootstrap>;
    let config: StorefrontConfig | undefined;
    const dataUpdatedAt = 123_000;
    function Harness() {
        value = useStorefrontBootstrap();
        return null;
    }
    function render() {
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            ),
        );
    }
    const nextConfig = (): StorefrontConfig => ({
        code: 'my-malaysia',
        defaultLanguageCode: 'en',
        defaultCurrencyCode: 'MYR',
        availableCountries: [{ code: 'MY', name: 'Malaysia' }],
        customFields: { storefrontNameZh: '测试店铺', storefrontNameEn: 'Test store' },
        description: ' 店铺说明 ',
        legalEntityName: ' Test Entity ',
    });
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        root = createRoot(document.createElement('div'));
        config = undefined;
        queries.read.mockReset().mockImplementation(() => ({
            configQuery: { data: config, dataUpdatedAt, refetch: vi.fn() },
            productsQuery: { data: undefined, refetch: vi.fn() },
            collectionsQuery: { refetch: vi.fn() },
        }));
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('keeps public requests gated until a configuration has resolved', () => {
        render();
        expect(value.storefrontContextResolved).toBe(false);
        expect(queries.read.mock.lastCall?.[0].storefrontContextResolved).toBe(false);
    });

    it('copies a changed market configuration with its original response age', () => {
        config = nextConfig();
        const key = [
            ...storefrontQueryKeys.config(
                storefrontQueryKeys.market(marketForStorefrontConfig(config)),
                'zh_Hans',
            ),
            'account',
        ];
        render();
        expect(client.getQueryData(key)).toEqual(config);
        expect(client.getQueryState(key)?.dataUpdatedAt).toBe(dataUpdatedAt);
        expect(value.market).toMatchObject({ code: 'my-malaysia', currencyCode: 'MYR' });
        expect(value.storefrontContextResolved).toBe(true);
        expect(value.storefrontName).toBe('测试店铺');
    });

    it('does not overwrite a newer configuration already cached for the destination', () => {
        config = nextConfig();
        const key = [
            ...storefrontQueryKeys.config(
                storefrontQueryKeys.market(marketForStorefrontConfig(config)),
                'zh_Hans',
            ),
            'account',
        ];
        const newer = { ...config, description: 'Newer response' };
        client.setQueryData(key, newer, { updatedAt: dataUpdatedAt + 1000 });
        render();
        expect(client.getQueryData(key)).toEqual(newer);
        expect(client.getQueryState(key)?.dataUpdatedAt).toBe(dataUpdatedAt + 1000);
    });

    it('loads favorites only from the resolved store and keeps localized/legal metadata', () => {
        config = nextConfig();
        localStorage.setItem(
            scopedStorageKey(FAVORITE_PRODUCT_STORAGE_KEY, enabledMarkets[0].code),
            '["other-store"]',
        );
        localStorage.setItem(scopedStorageKey(FAVORITE_PRODUCT_STORAGE_KEY, config.code), '["own-product"]');
        render();
        expect(value.favoriteProductIds).toEqual(['own-product']);
        expect(value.storefrontDescription).toBe('店铺说明');
        expect(value.legalIdentity.legalEntityName).toBe('Test Entity');
        expect(document.documentElement.lang).toBe('zh-CN');
        act(() => value.toggleLanguage());
        expect(value.language).toBe('en');
        expect(value.storefrontName).toBe('Test store');
    });
});
