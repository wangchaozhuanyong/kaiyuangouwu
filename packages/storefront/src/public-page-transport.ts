import {
    publicPageDataSearchParams,
    publicPageRequestKey,
    type PublicPageRequest,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { ShopApiGraphQlError } from './shop-api-errors';

let generation = 0;
export const publicPageReadGeneration = () => generation;
export function invalidatePublicPageReads(): void {
    generation++;
    bootstrap = undefined;
}

const flights = new Map<string, Promise<unknown>>();
let bootstrap:
    { key: string; promise: Promise<unknown>; languageCode?: string; currencyCode?: string } | undefined;

export function publicPageUrl(request: PublicPageRequest, languageCode?: string, currencyCode?: string): URL {
    const url = new URL('/_storefront/page-data', window.location.origin);
    url.search = publicPageDataSearchParams(request, { languageCode, currencyCode }).toString();
    return url;
}

/** Only in-flight reads are shared. Resolved data belongs exclusively to TanStack Query. */
export function requestPublicPage(url: URL): Promise<unknown> {
    const key = `${generation}:${url.href}`;
    const existing = flights.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
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
        .finally(() => {
            clearTimeout(timeout);
            if (flights.get(key) === promise) flights.delete(key);
        });
    flights.set(key, promise);
    return promise;
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
    }, 20_000);
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
export function awaitPublicPage(promise: Promise<unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(new DOMException('Request aborted', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        void promise
            .then(value => {
                if (!signal.aborted) resolve(value);
            }, reject)
            .finally(() => signal.removeEventListener('abort', abort));
    });
}
