import { shopAbuseMetadata, type ShopAbuseAction } from '../shop-abuse';
import { ShopApiGraphQlError } from '../shop-api-errors';
import { storefrontDocumentUrl } from '../storefront-preview-parameters';
import {
    AccountRecommendationSettings,
    StorefrontAuthSettings,
    StorefrontContentBlock,
    StorefrontFlashSale,
    StorefrontSystemAnnouncement,
} from '../types';

export { ShopApiGraphQlError } from '../shop-api-errors';

export const API_URL = String(import.meta.env.VITE_SHOP_API_URL ?? '/shop-api');
export const AUTH_TOKEN_HEADER = 'vendure-auth-token';
export const AUTH_TOKEN_STORAGE_PREFIX = 'vendure-shop-auth-token';
export const SHOP_API_QUERY_TIMEOUT_MS = 20_000;
export const SEND_CLIENT_CHANNEL_TOKEN =
    import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING !== 'false');

/** Both JSON and multipart requests target the same language/currency endpoint. */
export function shopApiUrl(language: string, currency: string): string {
    return `${API_URL}${API_URL.includes('?') ? '&' : '?'}languageCode=${encodeURIComponent(language)}&currencyCode=${encodeURIComponent(currency)}`;
}

export function shopApiHeaders(
    language: string | undefined,
    market: string,
    token: string | null,
): Record<string, string> {
    const headers: Record<string, string> = {};
    if (language) headers['language-code'] = language;
    if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = market;
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
}

export function isStorefrontQuery(document: string): boolean {
    return /^\s*(?:query\b|\{)/u.test(document);
}

export interface StorefrontContentQueryResult {
    storefrontContent: StorefrontContentBlock[];
    activeStorefrontFlashSales?: StorefrontFlashSale[];
    activeSystemAnnouncements?: StorefrontSystemAnnouncement[];
    storefrontContentSettings?: {
        heroAutoplayIntervalSeconds: number;
        configuredBlockTypes?: Array<StorefrontContentBlock['type']>;
        auth?: StorefrontAuthSettings;
        personalDataExportEnabled?: boolean;
        accountRecommendations?: AccountRecommendationSettings;
    };
}

export interface GraphQlResponse<T> {
    data?: T;
    errors?: Array<{
        message: string;
        extensions?: { code?: string; action?: unknown; retryAfterSeconds?: unknown };
    }>;
}

export interface ErrorResult {
    __typename?: string;
    errorCode?: string;
    message?: string;
    authenticationError?: string;
    causeCode?: string;
    action?: unknown;
    retryAfterSeconds?: unknown;
}

export function authTokenStorageKey(marketCode: string): string | null {
    if (typeof window === 'undefined') return null;
    const documentUrl = storefrontDocumentUrl();
    const apiUrl = new URL(API_URL, documentUrl);
    if (apiUrl.origin === new URL(documentUrl).origin) return null;
    return `${AUTH_TOKEN_STORAGE_PREFIX}:${apiUrl.origin}${apiUrl.pathname}:${marketCode}`;
}

export function readSessionAuthToken(storageKey: string | null): string | null {
    if (!storageKey) return null;
    try {
        return sessionStorage.getItem(storageKey);
    } catch {
        return null;
    }
}

export class ShopApiError extends Error {
    readonly action?: ShopAbuseAction;
    readonly retryAfterSeconds?: number;
    constructor(
        public readonly errorCode: string,
        message: string,
        public readonly authenticationError?: string,
        metadata?: unknown,
    ) {
        super(message);
        this.name = 'ShopApiError';
        Object.assign(this, shopAbuseMetadata(metadata));
    }
}

export class ShopApiTimeoutError extends Error {
    constructor(
        message: string,
        public readonly resultUnknown = false,
    ) {
        super(message);
        this.name = 'ShopApiTimeoutError';
    }
}

export function createShopApiTimeoutError(resultUnknown: boolean): ShopApiTimeoutError {
    return new ShopApiTimeoutError(
        resultUnknown
            ? '请求超时，提交结果暂时无法确认，请勿更改参数后重复提交'
            : '请求超时，请检查网络后重试',
        resultUnknown,
    );
}

export function isMissingStorefrontCatalogSchema(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
        error.message.includes('Unknown type "StorefrontCatalogInput"') ||
        error.message.includes('Cannot query field "storefrontCatalog"')
    );
}

export function createRequestSignal(external?: AbortSignal, timeoutMs?: number) {
    if (!timeoutMs) {
        return { signal: external, cleanup: () => undefined, didTimeout: () => false };
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternal = () => controller.abort(external?.reason);
    if (external?.aborted) abortFromExternal();
    else external?.addEventListener('abort', abortFromExternal, { once: true });
    const timer = timeoutMs
        ? setTimeout(() => {
              timedOut = true;
              controller.abort();
          }, timeoutMs)
        : undefined;
    return {
        signal: controller.signal,
        cleanup() {
            if (timer) clearTimeout(timer);
            external?.removeEventListener('abort', abortFromExternal);
        },
        didTimeout: () => timedOut,
    };
}

export function storefrontRealtimeUrl(): string {
    const url = new URL(API_URL, storefrontDocumentUrl());
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/shop-api\/?$/u, '/storefront-realtime/events');
    if (!url.pathname.endsWith('/storefront-realtime/events')) {
        url.pathname = '/storefront-realtime/events';
    }
    url.searchParams.set('client', 'storefront');
    return url.toString();
}

export function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve();
        const timer = window.setTimeout(finish, durationMs);
        signal.addEventListener('abort', finish, { once: true });
        function finish() {
            window.clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
        }
    });
}

export const STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS = 1_000;
export const STOREFRONT_REALTIME_MAX_RETRY_DELAY_MS = 30_000;
export const STOREFRONT_REALTIME_RATE_LIMIT_MIN_RETRY_DELAY_MS = 5_000;
export const STOREFRONT_REALTIME_RATE_LIMIT_MAX_RETRY_DELAY_MS = 60_000;
export const STOREFRONT_REALTIME_RETRY_JITTER_RATIO = 0.2;

export class StorefrontRealtimeConnectionError extends Error {
    constructor(
        readonly status: number,
        readonly retryAfter: string | null,
    ) {
        super(`Storefront realtime connection failed (${status})`);
        this.name = 'StorefrontRealtimeConnectionError';
    }
}

export function calculateStorefrontRealtimeRetry(options: {
    status?: number;
    retryAfter?: string | null;
    baseDelayMs: number;
    random?: number;
    nowMs?: number;
}): { delayMs: number; nextBaseDelayMs: number } {
    const rateLimited = options.status === 429;
    const minimumDelayMs = rateLimited
        ? STOREFRONT_REALTIME_RATE_LIMIT_MIN_RETRY_DELAY_MS
        : STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
    const maximumDelayMs = rateLimited
        ? STOREFRONT_REALTIME_RATE_LIMIT_MAX_RETRY_DELAY_MS
        : STOREFRONT_REALTIME_MAX_RETRY_DELAY_MS;
    const finiteBaseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : minimumDelayMs;
    const baseDelayMs = Math.min(maximumDelayMs, Math.max(minimumDelayMs, finiteBaseDelayMs));
    const retryAfterMs = rateLimited
        ? parseStorefrontRealtimeRetryAfter(options.retryAfter, options.nowMs ?? Date.now())
        : undefined;
    const requiredDelayMs = Math.min(maximumDelayMs, Math.max(baseDelayMs, retryAfterMs ?? 0));
    const minimumJitteredDelayMs =
        retryAfterMs == null
            ? Math.max(minimumDelayMs, requiredDelayMs * (1 - STOREFRONT_REALTIME_RETRY_JITTER_RATIO))
            : requiredDelayMs;
    const maximumJitteredDelayMs =
        retryAfterMs == null
            ? Math.min(maximumDelayMs, requiredDelayMs * (1 + STOREFRONT_REALTIME_RETRY_JITTER_RATIO))
            : Math.min(
                  maximumDelayMs,
                  requiredDelayMs + Math.min(1_000, requiredDelayMs * STOREFRONT_REALTIME_RETRY_JITTER_RATIO),
              );
    const candidateRandom = options.random ?? Math.random();
    const random = Number.isFinite(candidateRandom) ? Math.min(1, Math.max(0, candidateRandom)) : 0;

    return {
        delayMs: Math.round(
            minimumJitteredDelayMs + (maximumJitteredDelayMs - minimumJitteredDelayMs) * random,
        ),
        nextBaseDelayMs: Math.min(baseDelayMs * 2, maximumDelayMs),
    };
}

export function parseStorefrontRealtimeRetryAfter(
    value: string | null | undefined,
    nowMs: number,
): number | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    const seconds = Number(normalized);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    const retryAtMs = Date.parse(normalized);
    if (!Number.isFinite(retryAtMs)) return undefined;
    return Math.max(0, retryAtMs - nowMs);
}

export async function cancelStorefrontRealtimeBody(
    body: ReadableStream<Uint8Array> | null,
    reason: unknown,
): Promise<void> {
    if (!body || body.locked) return;
    try {
        await body.cancel(reason);
    } catch {
        // The connection failure remains the actionable error even if the body has already closed.
    }
}

export function parseShopApiResponse<T>(rawBody: string, status: number, ok: boolean): T {
    let body: GraphQlResponse<T>;
    try {
        body = JSON.parse(rawBody) as GraphQlResponse<T>;
    } catch {
        throw new ShopApiGraphQlError(
            [
                rawBody.trim()
                    ? `Shop API returned an invalid response (${status})`
                    : `Shop API did not respond (${status})`,
            ],
            status,
        );
    }
    if (body.errors?.length) {
        throw new ShopApiGraphQlError(
            body.errors.map(error => error.message),
            status,
            body.errors[0].extensions?.code,
            !Object.hasOwn(body, 'data') &&
                body.errors.every(error =>
                    ['GRAPHQL_PARSE_FAILED', 'GRAPHQL_VALIDATION_FAILED'].includes(
                        error.extensions?.code ?? '',
                    ),
                ),
            body.errors[0].extensions,
        );
    }
    if (!ok || !body.data) {
        throw new ShopApiGraphQlError([`Shop API request failed (${status})`], status);
    }
    return body.data;
}

export function assertNoShopApiError(result: ErrorResult): void {
    if (result.errorCode)
        throw new ShopApiError(
            result.causeCode ?? result.errorCode,
            result.message ?? result.errorCode,
            result.authenticationError,
            result,
        );
}
