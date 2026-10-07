// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApiGraphQlError } from '../api/helpers';
import { enabledMarkets, marketForStorefrontConfig } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { scopedStorageKey } from '../storefront-storage';
import { FAVORITE_PRODUCT_STORAGE_KEY } from '../storefront-utils';
import { Product, StorefrontConfig } from '../types';

import { StorefrontQueryContext } from './storefront-query-context';
import { useStorefrontBootstrap } from './useStorefrontBootstrap';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const queries = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./useStorefrontPublicData', () => ({ useStorefrontPublicData: queries.read }));

describe('storefront bootstrap boundaries', () => {
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    let value: ReturnType<typeof useStorefrontBootstrap>;
    let config: StorefrontConfig | undefined;
    let configError: unknown;
    let listedProducts: Product[] | undefined;
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
    const currencyConfiguration = (usdtPaymentConfigured: boolean) => ({
        defaultCurrencyCode: 'MYR',
        availableCurrencyCodes: ['MYR', 'CNY'],
        selectorEnabled: true,
        cnyToMyrRate: 0.6,
        usdtDisplayEnabled: true,
        usdtMarkupPercent: 0,
        cnyPerUsdtRate: 7.2,
        myrPerUsdtRate: 4.32,
        usdtRateSource: 'test',
        usdtRateUpdatedAt: new Date().toISOString(),
        usdtRateAvailable: true,
        usdtPaymentConfigured,
    });
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        root = createRoot(document.createElement('div'));
        config = undefined;
        configError = undefined;
        listedProducts = undefined;
        queries.read.mockReset().mockImplementation(() => ({
            configQuery: { data: config, error: configError, dataUpdatedAt, refetch: vi.fn() },
            productsQuery: { data: listedProducts, refetch: vi.fn() },
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
    it('closes an already-loaded store, discards its scoped catalog cache and resumes reads after configuration recovery', () => {
        config = { ...nextConfig(), accessMode: 'PREVIEW' };
        render();
        const currentMarket = storefrontQueryKeys.market(value.market);
        const productKey = storefrontQueryKeys.product(currentMarket, 'zh_Hans', 'cached-product');
        const otherKey = storefrontQueryKeys.product('other:CNY', 'zh_Hans', 'unrelated-product');
        client.setQueryData(productKey, { id: 'cached-product' });
        client.setQueryData(otherKey, { id: 'unrelated-product' });
        configError = new ShopApiGraphQlError(['closed'], 403, 'STOREFRONT_CLOSED');
        render();
        expect(value.storefrontUnavailable).toBe(true);
        expect(value.storefrontContextResolved).toBe(false);
        expect(client.getQueryData(productKey)).toBeUndefined();
        expect(client.getQueryData(otherKey)).toEqual({ id: 'unrelated-product' });
        configError = undefined;
        config = { ...nextConfig(), accessMode: 'PREVIEW' };
        render();
        expect(value.storefrontUnavailable).toBe(false);
        expect(value.storefrontContextResolved).toBe(true);
        expect(value.storefrontAccessMode).toBe('PREVIEW');
    });
    it('reacts immediately to a current-scope closure, ignores other scopes and permissions, and only reopens after configuration succeeds', async () => {
        config = { ...nextConfig(), accessMode: 'PREVIEW' };
        render();
        const market = storefrontQueryKeys.market(value.market);
        const currentKey = storefrontQueryKeys.product(market, 'zh_Hans', 'current-product');
        const otherKey = storefrontQueryKeys.product('other:CNY', 'zh_Hans', 'other-product');
        const denied = new ShopApiGraphQlError(['closed'], 403, 'STOREFRONT_CLOSED');
        const readError = (key: readonly unknown[], error: Error) =>
            client
                .fetchQuery({ queryKey: key, staleTime: 0, queryFn: () => Promise.reject(error) })
                .catch(() => undefined);
        await act(async () => {
            await readError(otherKey, denied);
        });
        expect(value.storefrontUnavailable).toBe(false);
        await act(async () => {
            await readError(currentKey, new ShopApiGraphQlError(['permission'], 403, 'FORBIDDEN'));
        });
        expect(value.storefrontUnavailable).toBe(false);
        const configKey = [...storefrontQueryKeys.config(market, 'zh_Hans'), 'public'];
        let finishOldConfig!: (response: StorefrontConfig) => void;
        let oldRead!: Promise<unknown>;
        await act(async () => {
            oldRead = client
                .fetchQuery({
                    queryKey: configKey,
                    staleTime: 0,
                    queryFn: () =>
                        new Promise<StorefrontConfig>(resolve => {
                            finishOldConfig = resolve;
                        }),
                })
                .catch(() => undefined);
            await Promise.resolve();
        });
        await act(async () => {
            await readError(currentKey, denied);
        });
        expect(value.storefrontUnavailable).toBe(true);
        expect(value.storefrontContextResolved).toBe(false);
        expect(config.accessMode).toBe('PREVIEW');
        await act(async () => {
            finishOldConfig(config as StorefrontConfig);
            await oldRead;
        });
        expect(value.storefrontUnavailable).toBe(true);
        // A late catalog aggregate can seed an old PREVIEW configuration manually.
        // Only the following new configuration fetch may clear the rejection boundary.
        await act(async () => {
            client.setQueryData(configKey, config);
            await Promise.resolve();
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            await readError(configKey, new Error('network unavailable'));
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            await client.fetchQuery({
                queryKey: configKey,
                staleTime: 0,
                queryFn: () => Promise.resolve(config),
            });
        });
        expect(value.storefrontUnavailable).toBe(false);
        expect(value.storefrontContextResolved).toBe(true);
        await act(async () => {
            await readError(configKey, new ShopApiGraphQlError(['legacy closed'], 403, 'FORBIDDEN'));
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            client.setQueryData(configKey, config);
            await Promise.resolve();
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            await client.fetchQuery({
                queryKey: configKey,
                staleTime: 0,
                queryFn: () => Promise.resolve(config),
            });
        });
        expect(value.storefrontUnavailable).toBe(false);
        expect(value.storefrontContextResolved).toBe(true);
    });

    it('keeps an explicit CLOSED configuration authoritative over an older pending response until a fresh read reopens it', async () => {
        const preview: StorefrontConfig = {
            ...nextConfig(),
            code: enabledMarkets[0].code,
            defaultLanguageCode: enabledMarkets[0].defaultLanguageCode,
            defaultCurrencyCode: enabledMarkets[0].currencyCode,
            accessMode: 'PREVIEW',
        };
        const configKey = [
            ...storefrontQueryKeys.config(storefrontQueryKeys.market(enabledMarkets[0]), 'zh_Hans'),
            'public',
        ];
        client.setQueryData(configKey, preview);
        queries.read.mockImplementation(function useConfigFixture(context: StorefrontQueryContext) {
            return {
                configQuery: useQuery({
                    queryKey: [
                        ...storefrontQueryKeys.config(
                            storefrontQueryKeys.market(context.market),
                            context.vendureLanguageCode,
                        ),
                        'public',
                    ],
                    queryFn: () => Promise.resolve(preview),
                    staleTime: Infinity,
                }),
                productsQuery: { data: [], refetch: vi.fn() },
                collectionsQuery: { refetch: vi.fn() },
            };
        });
        render();
        expect(value.storefrontContextResolved).toBe(true);
        const productKey = storefrontQueryKeys.product(
            storefrontQueryKeys.market(value.market),
            'zh_Hans',
            'cached-product',
        );
        client.setQueryData(productKey, { id: 'cached-product' });
        let finishOldConfig!: (response: StorefrontConfig) => void;
        let oldRead!: Promise<unknown>;
        await act(async () => {
            oldRead = client
                .fetchQuery({
                    queryKey: configKey,
                    staleTime: 0,
                    queryFn: () =>
                        new Promise<StorefrontConfig>(resolve => {
                            finishOldConfig = resolve;
                        }),
                })
                .catch(() => undefined);
            await Promise.resolve();
        });
        await act(async () => {
            client.setQueryData(configKey, { ...preview, accessMode: 'CLOSED' });
            await Promise.resolve();
        });
        expect(value.storefrontUnavailable).toBe(true);
        expect(value.storefrontContextResolved).toBe(false);
        expect(client.getQueryData(productKey)).toBeUndefined();
        await act(async () => {
            finishOldConfig(preview);
            await oldRead;
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            client.setQueryData(configKey, preview);
            await Promise.resolve();
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            await client.fetchQuery({
                queryKey: configKey,
                staleTime: 0,
                queryFn: () => Promise.resolve(preview),
            });
        });
        expect(value.storefrontUnavailable).toBe(false);
        expect(value.storefrontContextResolved).toBe(true);
        await act(async () => {
            await client.fetchQuery({
                queryKey: configKey,
                staleTime: 0,
                queryFn: () => Promise.resolve({ ...preview, accessMode: 'CLOSED' as const }),
            });
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            client.setQueryData(configKey, preview);
            await Promise.resolve();
        });
        expect(value.storefrontUnavailable).toBe(true);
        await act(async () => {
            await client.fetchQuery({
                queryKey: configKey,
                staleTime: 0,
                queryFn: () => Promise.resolve(preview),
            });
        });
        expect(value.storefrontUnavailable).toBe(false);
        expect(value.storefrontContextResolved).toBe(true);
    });

    it('copies a changed market configuration with its original response age', () => {
        config = nextConfig();
        const key = [
            ...storefrontQueryKeys.config(
                storefrontQueryKeys.market(marketForStorefrontConfig(config)),
                'zh_Hans',
            ),
            'public',
        ];
        render();
        expect(client.getQueryData(key)).toEqual(config);
        expect(client.getQueryState(key)?.dataUpdatedAt).toBe(dataUpdatedAt);
        expect(value.market).toMatchObject({ code: 'my-malaysia', currencyCode: 'MYR' });
        expect(value.storefrontContextResolved).toBe(true);
        expect(value.storefrontName).toBe('测试店铺');
    });

    it('keeps listing summaries out of the complete product-detail cache', () => {
        config = nextConfig();
        listedProducts = [
            { id: 'named', name: 'List title' } as Product,
            { id: 'untitled', name: '' } as Product,
        ];
        render();
        for (const product of listedProducts) {
            const key = storefrontQueryKeys.product(
                storefrontQueryKeys.market(value.market),
                'zh_Hans',
                product.id,
            );
            expect(client.getQueryData(key)).toBeUndefined();
        }
    });

    it('does not overwrite a newer configuration already cached for the destination', () => {
        config = nextConfig();
        const key = [
            ...storefrontQueryKeys.config(
                storefrontQueryKeys.market(marketForStorefrontConfig(config)),
                'zh_Hans',
            ),
            'public',
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
        localStorage.setItem('storefront-favorite-product-ids:my-malaysia', '["previous-account"]');
        render();
        expect(value.favoriteProductIds).toEqual(['own-product']);
        expect(value.storefrontDescription).toBe('店铺说明');
        expect(value.legalIdentity.legalEntityName).toBe('Test Entity');
        expect(document.documentElement.lang).toBe('zh-CN');
        act(() => value.toggleLanguage());
        expect(value.language).toBe('en');
        expect(value.storefrontName).toBe('Test store');
    });

    it('offers USDT only when both the quote and receiving-wallet gates are ready', () => {
        config = { ...nextConfig(), currencyConfiguration: currencyConfiguration(false) };
        render();
        expect(value.availableCurrencyCodes).toEqual(['MYR', 'CNY']);

        config = { ...nextConfig(), currencyConfiguration: currencyConfiguration(true) };
        render();
        expect(value.availableCurrencyCodes).toEqual(['MYR', 'CNY', 'USDT']);
    });
});
