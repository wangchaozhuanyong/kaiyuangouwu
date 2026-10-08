// organize-imports-ignore
import type { CollectionSummary, Product, StorefrontConfig, StorefrontContentResponse } from './types';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import {
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
    publicPageRequestKey,
    publicPageRequestFromUrl,
    canonicalPublicPageRequest,
    isReusablePublicPageData,
    type PublicPageRequest,
    type StorefrontPageData,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { storefrontNavigationCollections } from './api/catalog';
import { SEND_CLIENT_CHANNEL_TOKEN } from './api/helpers';
import { languageCodeFor, marketForStorefrontConfig } from './i18n';
import { asListProduct } from './product-summary';
import {
    awaitPublicPage,
    publicPageUrl,
    requestPublicPage,
    takePublicPageBootstrap,
    publicPageReadGeneration,
} from './public-page-transport';
import {
    isStorefrontScopeAccessDenied,
    markStorefrontPublicQuerySource,
    restrictStorefrontScopePersistence,
    storefrontQueryKeys,
} from './query-client';
import { ShopApiGraphQlError } from './shop-api-errors';
import { storefrontPreviewParameters } from './storefront-preview-parameters';
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
    allowClosed = false,
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
        (page.config?.accessMode === undefined ||
            page.config.accessMode === 'LIVE' ||
            page.config.accessMode === 'PREVIEW' ||
            (allowClosed && page.config.accessMode === 'CLOSED')) &&
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
    if (storefrontPreviewParameters().get('storefrontPreviewEmbedded') === '1') return;
    try {
        const value: unknown = JSON.parse(
            document.getElementById(STOREFRONT_PAGE_DATA_ELEMENT_ID)?.textContent ?? 'null',
        );
        if (!validatePublicPageData(value, window.location.host) || !isReusablePublicPageData(value)) return;
        const request = currentPublicPageRequest();
        if (
            value.requestKey
                ? value.requestKey !== publicPageRequestKey(request)
                : value.route !== window.location.pathname
        )
            return;
        const market = marketForStorefrontConfig(value.config);
        if (
            value.scope.languageCode !== languageCodeFor(readStoredLanguage(market)) ||
            value.scope.currencyCode !== readStoredSettlementCurrency(market)
        )
            return;
        pageGenerations.set(value, publicPageReadGeneration());
        return value;
    } catch {
        return;
    }
}

/** Seed existing query owners, never create a second cache of server data. */
export function seedPublicPage(
    client: QueryClient,
    page: PublicPageData,
    includeConfig = true,
    includeRoute = true,
): void {
    const market = `${page.scope.channelCode}:${page.scope.currencyCode}`;
    const language = page.scope.languageCode;
    if (
        page.config.accessMode === 'CLOSED' ||
        isStorefrontScopeAccessDenied(client, { marketCode: market, languageCode: language }) ||
        (pageGenerations.has(page) && pageGenerations.get(page) !== publicPageReadGeneration())
    )
        return;
    if (page.config.accessMode === 'PREVIEW')
        restrictStorefrontScopePersistence(client, { marketCode: market, languageCode: language });
    const set = (key: QueryKey, data: unknown) => {
        if (data === undefined) return;
        const previous = client.getQueryState(key);
        if (previous && previous.dataUpdatedAt > page.generatedAt) return;
        client.setQueryData(key, data, { updatedAt: page.generatedAt });
        markStorefrontPublicQuerySource(client, key, page.config.accessMode);
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
    // An API query in progress owns its result commit and pagination; do not collapse its pages.
    if (includeRoute && page.request?.kind === 'catalog' && page.catalog && !page.request.input.skip) {
        const key = storefrontQueryKeys.catalog(market, language, { ...page.request.input });
        const existing = client.getQueryData<{ pages: unknown[] }>(key);
        if (client.getQueryState(key)?.fetchStatus !== 'fetching' && (existing?.pages.length ?? 0) <= 1) {
            set(key, {
                pages: [{ ...page.catalog, items: page.catalog.items.map(asListProduct) }],
                pageParams: [0],
            });
        }
    }
    if (includeRoute && page.request?.kind === 'product' && page.product !== undefined) {
        const key = storefrontQueryKeys.product(market, language, page.request.id);
        if (client.getQueryState(key)?.fetchStatus !== 'fetching') set(key, page.product);
    }
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
    if (storefrontPreviewParameters().get('storefrontPreviewEmbedded') === '1') return;
    const normalized = canonicalPublicPageRequest(request);
    const url = publicPageUrl(normalized, languageCode, currencyCode);
    const generation = publicPageReadGeneration();
    const key = `${generation}:${url.href}`;
    let flight = validatedFlights.get(key);
    if (!flight) {
        flight = (async () => {
            const early = takePublicPageBootstrap(normalized);
            let value = early
                ? await early.catch(error => {
                      // Closure must reach the query owner; retrying it would hide the denial.
                      if (error instanceof ShopApiGraphQlError && error.status === 403) throw error;
                      return undefined;
                  })
                : undefined;
            // A first visit may have no preference cookie yet. Only adopt an exact public scope.
            if (
                value !== undefined &&
                (!validatePublicPageData(value, window.location.host, Date.now(), true) ||
                    value.scope.languageCode !== languageCode ||
                    (currencyCode && value.scope.currencyCode !== currencyCode))
            )
                value = undefined;
            const responsePage: unknown = value ?? (await requestPublicPage(url));
            if (responsePage === undefined) return undefined;
            // A CLOSED envelope is not hydratable, but its verified identity may close this read's scope.
            if (!validatePublicPageData(responsePage, window.location.host, Date.now(), true))
                throw new Error('Invalid public responsePage scope or version');
            if (
                responsePage.scope.languageCode !== languageCode ||
                (currencyCode && responsePage.scope.currencyCode !== currencyCode)
            )
                throw new Error('Public responsePage response has a different language or currency');
            if (
                responsePage.requestKey &&
                (responsePage.requestKey !== publicPageRequestKey(normalized) ||
                    !responsePage.request ||
                    publicPageRequestKey(responsePage.request) !== responsePage.requestKey)
            )
                throw new Error('Public responsePage response has a different request');
            if (responsePage.config.accessMode === 'CLOSED' && !responsePage.requestKey) {
                const legacyRequest =
                    typeof responsePage.route === 'string'
                        ? publicPageRequestFromUrl(responsePage.route)
                        : undefined;
                if (
                    !legacyRequest ||
                    publicPageRequestKey(legacyRequest) !== publicPageRequestKey(normalized)
                )
                    throw new Error('Public responsePage response has a different request');
            }
            pageGenerations.set(responsePage, generation);
            return responsePage;
        })();
        validatedFlights.set(key, flight);
        void flight
            .finally(() => {
                if (validatedFlights.get(key) === flight) validatedFlights.delete(key);
            })
            .catch(() => undefined);
    }
    let page: PublicPageData | undefined;
    try {
        page = (await awaitPublicPage(flight, signal)) as PublicPageData | undefined;
    } catch (error) {
        if (signal?.aborted || generation !== publicPageReadGeneration())
            throw new DOMException('Request invalidated', 'AbortError');
        throw error;
    }
    if (signal?.aborted || generation !== publicPageReadGeneration())
        throw new DOMException('Request invalidated', 'AbortError');
    if (page && expectedChannelCode && page.scope.channelCode !== expectedChannelCode)
        throw new Error('Public page response has a different channel');
    // The shared flight cannot choose a caller's Channel; validate it after each independent abort/generation fence.
    if (page?.config.accessMode === 'CLOSED')
        throw new ShopApiGraphQlError(['店铺暂未开放'], 403, 'STOREFRONT_CLOSED');
    return page;
}

const validatedFlights = new Map<string, Promise<PublicPageData | undefined>>();
const pageGenerations = new WeakMap<PublicPageData, number>();

export function currentPublicPageRequest(href?: string): PublicPageRequest {
    try {
        return (
            publicPageRequestFromUrl(href ?? window.location.pathname + window.location.search) ?? {
                kind: 'home',
            }
        );
    } catch {
        return { kind: 'home' };
    }
}

let navigationScope: { channelCode: string; currencyCode: string; languageCode: string } | undefined;
export function setPublicPageNavigationScope(scope: typeof navigationScope) {
    navigationScope = scope;
}

/** Navigation starts code and data together; the route query adopts this exact response. */
export async function prefetchPublicPage(client: QueryClient, href: string): Promise<void> {
    const scope = navigationScope;
    if (!scope) return;
    if (
        isStorefrontScopeAccessDenied(client, {
            marketCode: `${scope.channelCode}:${scope.currencyCode}`,
            languageCode: scope.languageCode,
        })
    )
        return;
    let request: PublicPageRequest | undefined;
    try {
        request = publicPageRequestFromUrl(href);
    } catch {
        return;
    }
    if (!request) return;
    // Opening the search input does not require an unfiltered catalog result.
    if (request.kind === 'catalog' && request.path === '/search' && !request.input.term) return;
    const market = `${scope.channelCode}:${scope.currencyCode}`;
    const key =
        request.kind === 'catalog'
            ? storefrontQueryKeys.catalog(market, scope.languageCode, { ...request.input })
            : request.kind === 'product'
              ? storefrontQueryKeys.product(market, scope.languageCode, request.id)
              : storefrontQueryKeys.products(market, scope.languageCode, 12);
    const cached = client.getQueryState(key);
    if (cached?.data !== undefined && !cached.isInvalidated && Date.now() - cached.dataUpdatedAt < 30_000)
        return;
    const read = async () => {
        const page = await fetchPublicPage(
            scope.languageCode,
            scope.currencyCode,
            undefined,
            request,
            scope.channelCode,
        );
        if (page && navigationScope === scope) seedPublicPage(client, page);
    };
    if (cached?.data !== undefined) {
        // Cached destinations render immediately, even when a background read is due.
        // Existing infinite queries retain their own full pagination refresh.
        const query = client.getQueryCache().find({ queryKey: key, exact: true });
        const refresh = query?.options.queryFn
            ? client.refetchQueries({ queryKey: key, exact: true, type: 'all' }, { cancelRefetch: false })
            : read();
        void refresh.catch(() => undefined);
        return;
    }
    await read();
}
