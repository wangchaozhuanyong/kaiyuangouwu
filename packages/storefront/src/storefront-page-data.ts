// organize-imports-ignore
import type { ShopApi } from './api';
import type {
    CollectionSummary,
    Product,
    StorefrontCatalogInput,
    StorefrontConfig,
    StorefrontContentResponse,
} from './types';
import type { MediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import {
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
    publicPageRequestKey,
    publicPageRequestFromUrl,
    canonicalPublicPageRequest,
    isReusablePublicPageData,
    publicLanguageFromUrl,
    type PublicPageRequest,
    type StorefrontPageData,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { storefrontNavigationCollections } from './api/catalog';
import { SEND_CLIENT_CHANNEL_TOKEN } from './api/helpers';
import { nextCatalogPageParam, validateCatalogPage } from './catalog-pagination';
import { buildBestSellerProducts } from './home-merchandising';
import { languageCodeFor, marketForStorefrontConfig } from './i18n';
import { asListProduct } from './product-summary';
import {
    awaitPublicPage,
    cancelPublicPageRequest,
    publicPageUrl,
    requestPublicPage,
    takePublicPageBootstrap,
    publicPageReadGeneration,
    publicPageReadDeadline,
} from './public-page-transport';
import {
    isStorefrontScopeAccessDenied,
    PUBLIC_QUERY_STALE_TIME,
    PUBLIC_QUERY_GC_TIME,
    publicQueryMeta,
    markStorefrontPublicQuerySource,
    restrictStorefrontScopePersistence,
    storefrontQueryClient,
    storefrontQueryKeys,
} from './query-client';
import { preloadStorefrontRouteComponent } from './route-component-preload';
import { ShopApiGraphQlError } from './shop-api-errors';
import { storefrontPreviewParameters } from './storefront-preview-parameters';
import { routeFromRouterLocation, routeHref } from './storefront-router';
import {
    contentStringArraySetting,
    contentNumberSetting,
    readStoredLanguage,
    readStoredSettlementCurrency,
} from './storefront-utils';

export type PublicPageData = StorefrontPageData<
    StorefrontConfig,
    StorefrontContentResponse,
    Product,
    CollectionSummary
>;

export function publicSeoQueryKey(
    market: string,
    language: string,
    request: PublicPageRequest,
    part: 'public-seo' | 'public-media' = 'public-seo',
    collections?: CollectionSummary[],
) {
    return [
        ...storefrontQueryKeys.scope(market, language),
        part,
        publicPageRequestKey(
            part === 'public-media' && request.kind === 'catalog'
                ? { ...request, input: catalogRequestInput(request, collections) }
                : request,
        ),
    ] as const;
}

function catalogRequestInput(
    request: Extract<PublicPageRequest, { kind: 'catalog' }>,
    collections?: CollectionSummary[],
) {
    const { collectionId, ...input } = request.input;
    return {
        ...input,
        collectionId:
            collectionId && collectionId !== 'all'
                ? collectionId
                : request.path === '/search'
                  ? undefined
                  : collections?.find(item => item.id && item.id !== 'all')?.id,
    };
}

function hasPublicPageIdentity(value: unknown, host: string, allowClosed = false): value is PublicPageData {
    const page = value as Partial<PublicPageData> | null;
    const scope = page?.scope;
    return Boolean(
        page &&
        page.schemaVersion === 1 &&
        scope &&
        (scope.host === host || host.startsWith('127.') || host.startsWith('localhost')) &&
        scope.priceContext === 'public' &&
        scope.channelCode &&
        ['en', 'zh_Hans'].includes(scope.languageCode) &&
        scope.currencyCode &&
        page.config?.code === scope.channelCode &&
        (page.config?.accessMode === undefined ||
            page.config.accessMode === 'LIVE' ||
            page.config.accessMode === 'PREVIEW' ||
            (allowClosed && page.config.accessMode === 'CLOSED')) &&
        page.config?.customFields &&
        Array.isArray(page.config?.availableCountries) &&
        typeof page.generatedAt === 'number' &&
        Number.isFinite(page.generatedAt) &&
        page.generatedAt > 0 &&
        Array.isArray(page.media) &&
        Array.isArray(page.failures),
    );
}

export function validatePublicPageData(
    value: unknown,
    host: string,
    now = Date.now(),
    allowClosed = false,
): value is PublicPageData {
    return (
        hasPublicPageIdentity(value, host, allowClosed) &&
        now - value.generatedAt <= 30_000 &&
        value.generatedAt - now <= 5_000
    );
}

export function readInitialPublicPage(): PublicPageData | undefined {
    if (typeof document === 'undefined' || SEND_CLIENT_CHANNEL_TOKEN) return;
    if (storefrontPreviewParameters().get('storefrontPreviewEmbedded') === '1') return;
    try {
        const value: unknown = JSON.parse(
            document.getElementById(STOREFRONT_PAGE_DATA_ELEMENT_ID)?.textContent ?? 'null',
        );
        // The HTML already on screen owns its first client tree. Network/cache
        // snapshots still need freshness; this document must not become a blank
        // client mount because scripts arrived late or the device clock differs.
        const root = document.getElementById('root');
        const renderedDocument = root?.dataset?.publicRendered === '1' && root.dataset.publicAdopted !== '1';
        if (!hasPublicPageIdentity(value, window.location.host) || !isReusablePublicPageData(value)) return;
        if (!renderedDocument && !validatePublicPageData(value, window.location.host)) return;
        // Legacy email hashes normalize to auth paths before bootstrap. A home
        // fallback here would incorrectly hydrate the homepage as that auth page.
        const request = publicPageRequestFromUrl(window.location.pathname + window.location.search);
        if (!request) return;
        if (
            value.requestKey
                ? value.requestKey !== publicPageRequestKey(request)
                : value.route !== window.location.pathname
        )
            return;
        const market = marketForStorefrontConfig(value.config);
        if (
            value.scope.languageCode !==
                (publicLanguageFromUrl(window.location.pathname) ??
                    (renderedDocument
                        ? value.scope.languageCode
                        : languageCodeFor(readStoredLanguage(market)))) ||
            (!renderedDocument && value.scope.currencyCode !== readStoredSettlementCurrency(market))
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
    const request = page.request;
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
        // A slow device clock must not turn this document into a future-dated
        // fresh cache entry. Preserve its presentation and revalidate via Query.
        const now = Date.now();
        const updatedAt = page.generatedAt - now > 5_000 ? now - PUBLIC_QUERY_STALE_TIME : page.generatedAt;
        const previous = client.getQueryState(key);
        if (previous && previous.dataUpdatedAt > updatedAt) return;
        const committed = client.setQueryData(key, data, { updatedAt });
        markStorefrontPublicQuerySource(client, key, page.config.accessMode);
        return committed;
    };
    if (includeConfig) set([...storefrontQueryKeys.config(market, language), 'public'], page.config);
    if (request) set(publicSeoQueryKey(market, language, request), page.seo ?? null);
    if (request?.kind === 'article')
        set(
            [...storefrontQueryKeys.scope(market, language), 'public-content', publicPageRequestKey(request)],
            page.publicContent ?? null,
        );
    set([...storefrontQueryKeys.content(market, language), 'public'], page.content);
    const collections = page.collections && storefrontNavigationCollections(page.collections);
    set(storefrontQueryKeys.collections(market, language), collections);
    set(storefrontQueryKeys.products(market, language, 12), page.products?.map(asListProduct));
    if (request?.kind === 'home' && page.bestSellers) {
        const best = page.bestSellers;
        const candidates = best.catalog.items.map(asListProduct);
        const pinned = best.pinnedProducts.map(asListProduct);
        set(
            storefrontQueryKeys.catalog(market, language, {
                purpose: 'home-best-sellers',
                sort: 'sales',
                take: best.candidateCount,
            }),
            { ...best.catalog, items: candidates },
        );
        set(
            [
                ...storefrontQueryKeys.scope(market, language),
                'home-best-seller-sales',
                candidates.map(item => item.id),
            ],
            best.salesByProductId,
        );
        const block = page.content?.blocks.find(item => item.type === 'BEST_SELLERS');
        const pinnedIds = contentStringArraySetting(block?.settings?.pinnedProductIds);
        if (pinnedIds.length) set(storefrontQueryKeys.productsByIds(market, language, pinnedIds), pinned);
        const count = Math.min(50, Math.max(1, contentNumberSetting(block?.settings?.displayCount, 4)));
        const selected = buildBestSellerProducts({
            pinnedProducts: pinned,
            candidates: [...candidates, ...pinned],
            salesByProductId: best.salesByProductId,
            count,
            seed: `${page.scope.channelCode}:${new Date(page.generatedAt).toISOString().slice(0, 10)}:best-sellers`,
        });
        set(['recommendation-order', JSON.stringify([market, language]), 'best-sellers'], selected);
        if (selected.length)
            set(
                storefrontQueryKeys.productsByIds(
                    market,
                    language,
                    selected.map(item => item.id),
                ),
                selected,
            );
    }
    const managedIds = Array.from(
        new Set(
            (page.content?.blocks ?? []).flatMap(block => [
                ...contentStringArraySetting(block.settings?.selectedProductIds),
                ...contentStringArraySetting(block.settings?.pinnedProductIds),
                ...(block.targetType === 'PRODUCT' && block.targetValue ? [block.targetValue] : []),
                ...(block.items ?? []).flatMap(item =>
                    item.targetType === 'PRODUCT' && item.targetValue ? [item.targetValue] : [],
                ),
            ]),
        ),
    );
    const managedProducts = managedIds.flatMap(id => {
        const product = page.products?.find(candidate => candidate.id === id);
        return product ? [asListProduct(product)] : [];
    });
    if (managedIds.length && managedProducts.length === managedIds.length)
        set(storefrontQueryKeys.productsByIds(market, language, managedIds), managedProducts);
    set([...storefrontQueryKeys.scope(market, language), 'visual-preset'], page.visualPreset);
    const committedMedia = set(
        publicSeoQueryKey(market, language, request ?? { kind: 'home' }, 'public-media', collections),
        page.media,
    ) as MediaDescriptor[] | undefined;
    if (committedMedia)
        publicMediaOrigins.set(committedMedia, [
            publicPageReadGeneration(),
            page.scope,
            page.config.accessMode,
            new Map(
                (page.catalog?.items ?? []).map(product => [
                    product.id,
                    product.featuredAsset?.preview || product.assets?.find(asset => asset.preview)?.preview,
                ]),
            ),
        ]);
    set(storefrontQueryKeys.flashSales(market, language), page.flashSales);
    // An API query in progress owns its result commit and pagination; do not collapse its pages.
    if (includeRoute && request?.kind === 'catalog' && page.catalog) {
        // Reuse this seed's normalized collections; the public request was already validated.
        const input = catalogRequestInput(request, collections);
        const key = storefrontQueryKeys.catalog(market, language, input);
        const existing = client.getQueryState<{ pages: unknown[] }>(key);
        if (existing?.fetchStatus !== 'fetching' && (existing?.data?.pages.length ?? 0) <= 1) {
            set(key, {
                pages: [{ ...page.catalog, items: page.catalog.items.map(asListProduct) }],
                pageParams: [input.skip ?? 0],
            });
        }
    }
    if (includeRoute && request?.kind === 'product' && page.product !== undefined) {
        const key = storefrontQueryKeys.product(market, language, request.id);
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
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (SEND_CLIENT_CHANNEL_TOKEN || typeof window === 'undefined') return;
    if (storefrontPreviewParameters().get('storefrontPreviewEmbedded') === '1') return;
    const normalized = canonicalPublicPageRequest(request);
    const url = publicPageUrl(normalized, languageCode, currencyCode);
    const generation = publicPageReadGeneration();
    const key = `${generation}:${url.href}`;
    let flight = validatedFlights.get(key);
    if (!flight) {
        const promise = (async () => {
            const early = takePublicPageBootstrap(normalized, { languageCode, currencyCode });
            const deadline = publicPageReadDeadline(signal, early);
            // Early and formal reads are one operation. Query alone owns retries.
            let value = early ? await early : undefined;
            if (flight && validatedFlights.get(key) !== flight)
                throw new DOMException('Request aborted', 'AbortError');
            // A first visit may have no preference cookie yet. Only adopt an exact public scope.
            if (
                value !== undefined &&
                (!validatePublicPageData(value, window.location.host, Date.now(), true) ||
                    value.scope.languageCode !== languageCode ||
                    (currencyCode && value.scope.currencyCode !== currencyCode))
            )
                value = undefined;
            const responsePage: unknown = value ?? (await requestPublicPage(url, deadline));
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
        flight = { promise, consumers: 0 };
        validatedFlights.set(key, flight);
        void promise
            .finally(() => {
                if (validatedFlights.get(key) === flight) validatedFlights.delete(key);
            })
            .catch(() => undefined);
    }
    flight.consumers++;
    let page: PublicPageData | undefined;
    try {
        page = (await awaitPublicPage(
            flight.promise,
            signal,
            publicPageReadDeadline(signal, flight.promise),
        )) as PublicPageData | undefined;
    } catch (error) {
        if (signal?.aborted || generation !== publicPageReadGeneration())
            throw new DOMException('Request invalidated', 'AbortError');
        throw error;
    } finally {
        if (--flight.consumers === 0 && signal?.aborted && validatedFlights.get(key) === flight) {
            validatedFlights.delete(key);
            cancelPublicPageRequest(url, generation);
        }
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

const validatedFlights = new Map<
    string,
    { promise: Promise<PublicPageData | undefined>; consumers: number }
>();
const pageGenerations = new WeakMap<PublicPageData, number>();
// Provenance of the existing Query-owned array, not another store of response data.
const publicMediaOrigins = new WeakMap<
    readonly MediaDescriptor[],
    readonly [
        number,
        PublicPageData['scope'],
        StorefrontConfig['accessMode'],
        ReadonlyMap<string, string | undefined>,
    ]
>();

export function publicMediaOrigin(media: readonly MediaDescriptor[]) {
    return publicMediaOrigins.get(media);
}

/** A received aggregate may defer a section; recover that section without downloading the page again. */
export function hasFreshPublicPage(
    client: QueryClient,
    request: PublicPageRequest,
    scope: Pick<PublicPageData['scope'], 'host' | 'channelCode' | 'languageCode' | 'currencyCode'>,
): boolean {
    const market = `${scope.channelCode}:${scope.currencyCode}`;
    if (isStorefrontScopeAccessDenied(client, { marketCode: market, languageCode: scope.languageCode }))
        return false;
    const collections = client.getQueryData<CollectionSummary[]>(
        storefrontQueryKeys.collections(market, scope.languageCode),
    );
    const state = client.getQueryState<MediaDescriptor[]>(
        publicSeoQueryKey(market, scope.languageCode, request, 'public-media', collections),
    );
    if (
        !state?.data ||
        state.status !== 'success' ||
        state.isInvalidated ||
        Date.now() - state.dataUpdatedAt >= 30_000
    )
        return false;
    const origin = publicMediaOrigin(state.data);
    return Boolean(
        origin &&
        origin[0] === publicPageReadGeneration() &&
        origin[1].host === scope.host &&
        origin[1].channelCode === scope.channelCode &&
        origin[1].languageCode === scope.languageCode &&
        origin[1].currencyCode === scope.currencyCode &&
        origin[2] !== 'CLOSED',
    );
}

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

let navigationScope:
    | {
          channelCode: string;
          currencyCode: string;
          languageCode: string;
          api?: Pick<ShopApi, 'product' | 'catalog'>;
      }
    | undefined;
export function setPublicPageNavigationScope(scope: typeof navigationScope) {
    navigationScope = scope;
}

/** Code waits belong to the leaf route so the shared shell remains interactive. */
export function storefrontRouteCodeLoader({
    location,
}: {
    location: { pathname: string; search: Record<string, unknown> };
}): Promise<void> {
    return preloadStorefrontRouteComponent(routeFromRouterLocation(location.pathname, location.search).name);
}

/** Warm the same Query data without holding the destination's body behind a network read. */
export async function publicPageRouteLoader({
    location,
    abortController,
}: {
    location: { publicHref: string; pathname: string; search: Record<string, unknown> };
    abortController: AbortController;
}): Promise<void> {
    const code = storefrontRouteCodeLoader({ location });
    void prefetchPublicPage(storefrontQueryClient, location.publicHref, abortController.signal).catch(
        () => undefined,
    );
    await code;
    // The route's required Query renders its own missing-data or recovery state.
}

/** Navigation starts code and data together; the route query adopts this exact response. */
export async function prefetchPublicPage(
    client: QueryClient,
    href: string,
    signal?: AbortSignal,
): Promise<void> {
    const scope = navigationScope;
    if (!scope) return;
    const market = `${scope.channelCode}:${scope.currencyCode}`;
    if (
        isStorefrontScopeAccessDenied(client, {
            marketCode: market,
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
    const language = publicLanguageFromUrl(href) ?? scope.languageCode;
    const catalog = request.kind === 'catalog' ? request : undefined;
    // Opening the search input does not require an unfiltered catalog result.
    if (catalog?.path === '/search' && !catalog.input.term) return;
    const collections = client.getQueryData<CollectionSummary[]>(
        storefrontQueryKeys.collections(market, language),
    );
    const input = catalog && catalogRequestInput(catalog, collections);
    const seoKey = publicSeoQueryKey(market, language, request);
    const key = catalog
        ? storefrontQueryKeys.catalog(market, language, input ?? {})
        : request.kind === 'product'
          ? storefrontQueryKeys.product(market, language, request.id)
          : seoKey;
    let cached = client.getQueryState(key);
    const mediaKey = publicSeoQueryKey(market, language, request, 'public-media', collections);
    const readPage = async (readSignal = signal) => {
        const page = await fetchPublicPage(
            language,
            scope.currencyCode,
            readSignal,
            request,
            scope.channelCode,
        );
        if (navigationScope !== scope) throw new DOMException('Navigation scope changed', 'AbortError');
        if (page) seedPublicPage(client, page);
        cached = client.getQueryState(key);
        return page;
    };
    if (cached?.data === undefined ? request.kind === 'home' : client.getQueryData(mediaKey) === undefined) {
        // Optional route hints must not hide an already available destination.
        // Re-enter the same owner after recovery so legacy/stale business reads keep their rules.
        const restoring = client.fetchQuery({
            queryKey: mediaKey,
            queryFn: async ({ signal: querySignal }) => {
                await readPage(querySignal);
                return client.getQueryData<PublicPageData['media']>(mediaKey) ?? [];
            },
            gcTime: PUBLIC_QUERY_GC_TIME,
        });
        void restoring
            .then(() => {
                // Legacy/unavailable aggregates cannot establish a home route owner.
                // Let its SPA queries take over instead of re-entering a fresh empty media query.
                if (navigationScope === scope && (request.kind !== 'home' || cached?.data !== undefined))
                    return prefetchPublicPage(client, href, signal);
            })
            .catch(() => undefined);
        // A first home read has no route cache yet; its existing Query owner must
        // also observe closure/errors while shared service content stays displayed.
        if (cached?.data === undefined) await awaitPublicPage(restoring, signal);
        return;
    }
    const queryOwned = Boolean(
        scope.api &&
        language === scope.languageCode &&
        (request.kind === 'product' ||
            (catalog && (input?.collectionId || catalog.path === '/search' || collections))),
    );
    if (
        cached?.data !== undefined &&
        !cached.isInvalidated &&
        Date.now() - cached.dataUpdatedAt < (queryOwned ? PUBLIC_QUERY_STALE_TIME : 30_000) &&
        (queryOwned || client.getQueryData(seoKey) !== undefined)
    )
        return;
    const read = async () => {
        const scopeApi = scope.api;
        // Warm the same query that the destination observes. Required read failures
        // stay in Query rather than disappearing in a speculative loader catch.
        // A cancelled router wait must not cancel a query still used by another page.
        if (scopeApi && queryOwned && request.kind === 'product') {
            const productId = request.id;
            await awaitPublicPage(
                client.fetchQuery({
                    queryKey: key,
                    queryFn: ({ signal: querySignal }) => scopeApi.product(productId, querySignal),
                    staleTime: PUBLIC_QUERY_STALE_TIME,
                    gcTime: PUBLIC_QUERY_GC_TIME,
                    meta: publicQueryMeta(),
                }),
                signal,
            );
            return;
        }
        if (scopeApi && queryOwned && catalog) {
            const routeInput: StorefrontCatalogInput = {
                ...input,
                sort: input?.sort?.toLowerCase().replaceAll('_', '-') as StorefrontCatalogInput['sort'],
                fulfillmentType:
                    input?.fulfillmentType?.toLowerCase() as StorefrontCatalogInput['fulfillmentType'],
            };
            await awaitPublicPage(
                client.fetchInfiniteQuery({
                    queryKey: key,
                    queryFn: async ({ pageParam, signal: querySignal }) =>
                        validateCatalogPage(
                            await scopeApi.catalog(
                                {
                                    ...routeInput,
                                    skip: pageParam,
                                    take: 12,
                                },
                                querySignal,
                                catalog.path === '/search' ? 'store' : 'route',
                            ),
                            pageParam,
                            new Set<string>(),
                            language === 'zh_Hans'
                                ? '暂时无法加载商品，请重试'
                                : 'Could not load products. Please retry.',
                        ),
                    initialPageParam: routeInput.skip ?? 0,
                    getNextPageParam: nextCatalogPageParam,
                    staleTime: PUBLIC_QUERY_STALE_TIME,
                    gcTime: PUBLIC_QUERY_GC_TIME,
                    meta: publicQueryMeta(),
                }),
                signal,
            );
            return;
        }
        await readPage();
    };
    if (cached?.data !== undefined) {
        // Cached destinations render immediately, even when a background read is due.
        // Existing infinite queries retain their own full pagination refresh.
        const query = client.getQueryCache().find({ queryKey: key, exact: true });
        const refresh =
            typeof query?.options.queryFn === 'function'
                ? client.refetchQueries({ queryKey: key, exact: true, type: 'all' }, { cancelRefetch: false })
                : read();
        void refresh.catch(() => undefined);
        return;
    }
    await read();
}
