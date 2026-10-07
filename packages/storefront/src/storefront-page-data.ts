// organize-imports-ignore
import type { CollectionSummary, Product, StorefrontConfig, StorefrontContentResponse } from './types';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import {
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
    type PublicPageRequest,
    type StorefrontPageData,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { storefrontNavigationCollections } from './api/catalog';
import { createRequestSignal, SEND_CLIENT_CHANNEL_TOKEN, ShopApiGraphQlError } from './api/helpers';
import { languageCodeFor, marketForStorefrontConfig } from './i18n';
import { asListProduct } from './product-summary';
import { storefrontQueryKeys } from './query-client';
import { readStoredLanguage, readStoredSettlementCurrency } from './storefront-utils';

export type PublicPageData = StorefrontPageData<
    StorefrontConfig,
    StorefrontContentResponse,
    Product,
    CollectionSummary
>;

export function validatePublicPageData(
    value: unknown,
    host: string,
    now = Date.now(),
): value is PublicPageData {
    const page = value as Partial<PublicPageData> | null;
    return Boolean(
        page &&
        page.schemaVersion === 1 &&
        page.scope?.host === host &&
        page.scope.priceContext === 'public' &&
        page.scope.channelCode &&
        ['en', 'zh_Hans'].includes(page.scope.languageCode) &&
        page.scope.currencyCode &&
        page.config?.code === page.scope.channelCode &&
        page.config?.customFields &&
        Array.isArray(page.config?.availableCountries) &&
        typeof page.generatedAt === 'number' &&
        now - page.generatedAt <= 30_000 &&
        page.generatedAt - now <= 5_000 &&
        Array.isArray(page.media) &&
        Array.isArray(page.failures),
    );
}

export function readInitialPublicPage(): PublicPageData | undefined {
    if (typeof document === 'undefined' || SEND_CLIENT_CHANNEL_TOKEN) return;
    if (new URLSearchParams(window.location.search).get('storefrontPreviewEmbedded') === '1') return;
    try {
        const value: unknown = JSON.parse(
            document.getElementById(STOREFRONT_PAGE_DATA_ELEMENT_ID)?.textContent ?? 'null',
        );
        if (!validatePublicPageData(value, window.location.host)) return;
        const market = marketForStorefrontConfig(value.config);
        if (
            value.scope.languageCode !== languageCodeFor(readStoredLanguage(market)) ||
            value.scope.currencyCode !== readStoredSettlementCurrency(market)
        )
            return;
        return value;
    } catch {
        return;
    }
}

/** Seed existing query owners, never create a second cache of server data. */
export function seedPublicPage(client: QueryClient, page: PublicPageData, includeConfig = true): void {
    const market = `${page.scope.channelCode}:${page.scope.currencyCode}`;
    const language = page.scope.languageCode;
    const set = (key: QueryKey, data: unknown) => {
        if (data === undefined) return;
        const previous = client.getQueryState(key);
        if (previous && previous.dataUpdatedAt > page.generatedAt) return;
        client.setQueryData(key, data, { updatedAt: page.generatedAt });
    };
    if (includeConfig) set([...storefrontQueryKeys.config(market, language), 'public'], page.config);
    set([...storefrontQueryKeys.content(market, language), 'public'], page.content);
    set(
        storefrontQueryKeys.collections(market, language),
        page.collections && storefrontNavigationCollections(page.collections),
    );
    set(storefrontQueryKeys.products(market, language, 12), page.products?.map(asListProduct));
    set([...storefrontQueryKeys.scope(market, language), 'visual-preset'], page.visualPreset);
    set(storefrontQueryKeys.flashSales(market, language), page.flashSales);
}

/** Undefined means the older deployment has no aggregate endpoint. Other failures remain visible. */
export async function fetchPublicPage(
    languageCode: string,
    currencyCode?: string,
    signal?: AbortSignal,
    request: PublicPageRequest = { kind: 'home' },
    expectedChannelCode?: string,
): Promise<PublicPageData | undefined> {
    if (SEND_CLIENT_CHANNEL_TOKEN || typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('storefrontPreviewEmbedded') === '1') return;
    const url = new URL('/_storefront/page-data', window.location.origin);
    url.searchParams.set('languageCode', languageCode);
    url.searchParams.set('kind', request.kind);
    if (request.kind === 'product') url.searchParams.set('id', request.id);
    if (request.kind === 'catalog') url.searchParams.set('input', JSON.stringify(request.input));
    if (currencyCode) url.searchParams.set('currencyCode', currencyCode);
    const timeout = createRequestSignal(signal, 20_000);
    try {
        const response = await fetch(url, {
            credentials: 'omit',
            headers: { Accept: 'application/json' },
            signal: timeout.signal,
        });
        if (
            response.status === 404 ||
            response.status === 501 ||
            (response.ok && !response.headers.get('content-type')?.includes('application/json'))
        )
            return;
        if (!response.ok) {
            const failure: unknown = await response.json().catch(() => null);
            const errorCode =
                typeof failure === 'object' &&
                failure !== null &&
                (failure as { errorCode?: unknown }).errorCode === 'STOREFRONT_CLOSED'
                    ? 'STOREFRONT_CLOSED'
                    : undefined;
            throw new ShopApiGraphQlError(
                [`Public page request failed (${response.status})`],
                response.status,
                errorCode,
            );
        }
        const page: unknown = await response.json();
        if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
        if (!validatePublicPageData(page, window.location.host))
            throw new Error('Invalid public page scope or version');
        if (
            (expectedChannelCode && page.scope.channelCode !== expectedChannelCode) ||
            page.scope.languageCode !== languageCode ||
            (currencyCode && page.scope.currencyCode !== currencyCode)
        ) {
            throw new Error('Public page response has a different language or currency');
        }
        return page;
    } finally {
        timeout.cleanup();
    }
}
