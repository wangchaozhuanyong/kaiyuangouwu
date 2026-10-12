// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    serializeStorefrontBootData,
    validateStorefrontBootData,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { initialLoadingBrandForBootData } from './brand-loading-bootstrap';
import {
    markStorefrontPublicQuerySource,
    storefrontQueryKeys,
    watchStorefrontScopeAccess,
} from './query-client';
import { ShopApiGraphQlError } from './shop-api-errors';
import { seedStorefrontBoot, type InitialStorefrontBoot } from './storefront-boot-data';

const fixture = (): InitialStorefrontBoot => ({
    schemaVersion: 1,
    generatedAt: Date.now(),
    configUpdatedAt: Date.now() - 10_000,
    scope: {
        host: window.location.host,
        channelCode: 'store-a',
        languageCode: 'en',
        currencyCode: 'MYR',
        priceContext: 'public',
    },
    config: {
        code: 'store-a',
        accessMode: 'LIVE',
        defaultLanguageCode: 'en',
        defaultCurrencyCode: 'MYR',
        availableCountries: [],
        customFields: { storefrontNameEn: 'Current store' },
    },
});
afterEach(() => vi.restoreAllMocks());

describe('anonymous configuration bootstrap', () => {
    it('requires exact scope, live authority and independent configuration age', () => {
        const value = fixture();
        const scope = {
            host: window.location.host,
            languageCode: 'en',
            currencyCode: 'MYR',
            now: value.generatedAt,
        };
        expect(validateStorefrontBootData(value, scope)).toBe(true);
        for (const invalid of [
            { ...value, generatedAt: NaN },
            { ...value, configUpdatedAt: value.generatedAt - 60_001 },
            { ...value, configUpdatedAt: value.generatedAt + 5_001 },
            { ...value, scope: { ...value.scope, host: 'other.test' } },
            { ...value, scope: { ...value.scope, languageCode: 'zh_Hans' } },
            { ...value, scope: { ...value.scope, priceContext: 'customer' } },
            { ...value, config: { ...value.config, code: 'other-store' } },
            { ...value, config: { ...value.config, accessMode: 'PREVIEW' } },
            { ...value, config: { ...value.config, accessMode: 'CLOSED' } },
        ])
            expect(validateStorefrontBootData(invalid, scope)).toBe(false);
    });
    it('brands private routes without a catalog or customer snapshot and escapes script terminators', () => {
        const value = fixture();
        value.config.customFields.storefrontNameEn = '</script><img src=x>';
        expect(initialLoadingBrandForBootData(value, { host: window.location.host })?.storefrontName).toBe(
            '</script><img src=x>',
        );
        const serialized = serializeStorefrontBootData(value);
        expect(serialized).not.toContain('</script>');
        expect(JSON.parse(serialized)).toEqual(value);
    });
    it('seeds one query owner with its original age without overwriting newer configuration', () => {
        const client = new QueryClient();
        const value = fixture();
        const key = [...storefrontQueryKeys.config('store-a:MYR', 'en'), 'public'];
        seedStorefrontBoot(client, value);
        expect(client.getQueryState(key)?.dataUpdatedAt).toBe(value.configUpdatedAt);
        client.setQueryData(key, { ...value.config, description: 'newer' }, { updatedAt: Date.now() });
        seedStorefrontBoot(client, value);
        expect(client.getQueryData(key)).toMatchObject({ description: 'newer' });
        expect(client.getQueryCache().getAll()).toHaveLength(1);
        client.clear();
    });
    it('cannot reopen a scope already denied by a live request', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const stop = watchStorefrontScopeAccess(client, () => undefined);
        const key = [...storefrontQueryKeys.config('store-a:MYR', 'en'), 'public'];
        markStorefrontPublicQuerySource(client, key, 'LIVE');
        await expect(
            client.fetchQuery({
                queryKey: key,
                queryFn: () => Promise.reject(new ShopApiGraphQlError(['Closed'], 403, 'STOREFRONT_CLOSED')),
            }),
        ).rejects.toThrow();
        seedStorefrontBoot(client, fixture());
        expect(client.getQueryData(key)).toBeUndefined();
        stop();
        client.clear();
    });
});
