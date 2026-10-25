import {
    publicPageDataSearchParams,
    publicPageRequestKey,
    type PublicPageRequest,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import {
    createShopApiTimeoutError,
    ShopApiGraphQlError,
    STOREFRONT_READ_TIMEOUT_MS,
} from './shop-api-errors';

const readDeadlines = new WeakMap<AbortSignal, number>();
const transportDeadlines = new WeakMap<Promise<unknown>, number>();
/** Query reuses its signal across automatic attempts; these maps hold no response data. */
export function publicPageReadDeadline(signal?: AbortSignal, early?: Promise<unknown>): number {
    const deadline = Math.min(
        Date.now() + STOREFRONT_READ_TIMEOUT_MS,
        signal ? (readDeadlines.get(signal) ?? Infinity) : Infinity,
        early ? (transportDeadlines.get(early) ?? Infinity) : Infinity,
    );
    if (signal) readDeadlines.set(signal, deadline);
    return deadline;
}
let generation = 0;
const generationListeners = new Set<() => void>();
export const publicPageReadGeneration = () => generation;
/** Control notifications only; response data remains exclusively in Query. */
export function watchPublicPageReadGeneration(notify: () => void): () => void {
    generationListeners.add(notify);
    return () => generationListeners.delete(notify);
}
export function invalidatePublicPageReads(): void {
    generation++;
    bootstrap = undefined;
    generationListeners.forEach(notify => notify());
}

const flights = new Map<string, { promise: Promise<unknown>; controller: AbortController }>();
let bootstrap:
    { key: string; promise: Promise<unknown>; languageCode?: string; currencyCode?: string } | undefined;

export function publicPageUrl(request: PublicPageRequest, languageCode?: string, currencyCode?: string): URL {
    const url = new URL('/_storefront/page-data', window.location.origin);
    url.search = publicPageDataSearchParams(request, { languageCode, currencyCode }).toString();
    return url;
}

/** Only in-flight reads are shared. Resolved data belongs exclusively to TanStack Query. */
export function requestPublicPage(
    url: URL,
    deadline = Date.now() + STOREFRONT_READ_TIMEOUT_MS,
): Promise<unknown> {
    if (deadline <= Date.now()) return Promise.reject(createShopApiTimeoutError(false));
    const key = `${generation}:${url.href}`;
    const existing = flights.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, deadline - Date.now());
    const promise = fetch(url, {
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
    })
        .then(async response => {
            if (
                response.status === 404 ||
                response.status === 501 ||
                (response.ok && !response.headers.get('content-type')?.includes('application/json'))
            )
                return undefined;
            if (!response.ok) {
                let body:
                    | {
                          errorCode?: unknown;
                          message?: unknown;
                          errors?: Array<{ message?: unknown; extensions?: { code?: unknown } }>;
                      }
                    | undefined;
                try {
                    body = await response.json();
                } catch {
                    // Non-JSON proxy failures retain their HTTP status and never fall back to a read.
                }
                const errorCode = body?.errorCode ?? body?.errors?.[0]?.extensions?.code;
                const message = body?.message ?? body?.errors?.[0]?.message;
                throw new ShopApiGraphQlError(
                    [
                        typeof message === 'string'
                            ? message
                            : `Public page request failed (${response.status})`,
                    ],
                    response.status,
                    typeof errorCode === 'string' ? errorCode : undefined,
                );
            }
            return response.json() as Promise<unknown>;
        })
        .catch(error => {
            if (timedOut) throw createShopApiTimeoutError(false);
            throw error;
        })
        .finally(() => {
            clearTimeout(timeout);
            if (flights.get(key)?.promise === promise) flights.delete(key);
        });
    transportDeadlines.set(promise, deadline);
    flights.set(key, { promise, controller });
    return promise;
}

/** The validated read owner calls this only after its final consumer leaves. */
export function cancelPublicPageRequest(url: URL, readGeneration: number): void {
    const key = `${readGeneration}:${url.href}`;
    const flight = flights.get(key);
    flights.delete(key);
    flight?.controller.abort();
}

export function startPublicPageBootstrap(
    request: PublicPageRequest,
    languageCode?: string,
    currencyCode?: string,
) {
    bootstrap = {
        key: publicPageRequestKey(request),
        promise: requestPublicPage(publicPageUrl(request, languageCode, currencyCode)),
        languageCode,
        currencyCode,
    };
    // It is a one-time handoff to the query owner, not a reusable response cache.
    const current = bootstrap;
    void current.promise.catch(() => undefined);
    setTimeout(() => {
        if (bootstrap === current) bootstrap = undefined;
    }, STOREFRONT_READ_TIMEOUT_MS * 3);
}

export function takePublicPageBootstrap(
    request: PublicPageRequest,
    scope?: { languageCode: string; currencyCode?: string },
): Promise<unknown> | undefined {
    if (bootstrap?.key !== publicPageRequestKey(request)) return;
    if (
        scope &&
        ((bootstrap.languageCode && scope.languageCode !== bootstrap.languageCode) ||
            (bootstrap.currencyCode && scope.currencyCode !== bootstrap.currencyCode))
    )
        return;
    const promise = bootstrap.promise;
    bootstrap = undefined;
    return promise;
}

/** Cancelling one subscriber cannot cancel another route's shared transport. */
export function awaitPublicPage(
    promise: Promise<unknown>,
    signal?: AbortSignal,
    deadline?: number,
): Promise<unknown> {
    if (!signal && deadline === undefined) return promise;
    if (signal?.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        };
        const abort = () => {
            cleanup();
            reject(new DOMException('Request aborted', 'AbortError'));
        };
        const timer =
            deadline === undefined
                ? undefined
                : setTimeout(
                      () => {
                          cleanup();
                          reject(createShopApiTimeoutError(false));
                      },
                      Math.max(0, deadline - Date.now()),
                  );
        signal?.addEventListener('abort', abort, { once: true });
        void promise.then(
            value => {
                cleanup();
                resolve(value);
            },
            (error: Error) => {
                cleanup();
                reject(error);
            },
        );
    });
}
