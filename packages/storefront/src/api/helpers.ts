import { productAvailability } from '../product-availability';
import {
    Product,
    StorefrontCatalogInput,
    StorefrontContentBlock,
    StorefrontFlashSale,
    StorefrontSystemAnnouncement,
} from '../types';

export const API_URL = String(import.meta.env.VITE_SHOP_API_URL ?? '/shop-api');
export const AUTH_TOKEN_HEADER = 'vendure-auth-token';
export const AUTH_TOKEN_STORAGE_PREFIX = 'vendure-shop-auth-token';

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
    };
}

export function isStorefrontContentSchemaCompatibilityError(error: unknown): boolean {
    return (
        error instanceof Error &&
        /cannot query field|unknown (?:field|argument)|is not defined by type/iu.test(error.message)
    );
}

export interface GraphQlResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

export interface ErrorResult {
    __typename?: string;
    errorCode?: string;
    message?: string;
    authenticationError?: string;
}

export function authTokenStorageKey(marketCode: string): string | null {
    if (typeof window === 'undefined') return null;
    const apiUrl = new URL(API_URL, window.location.href);
    if (apiUrl.origin === window.location.origin) return null;
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
    constructor(
        public readonly errorCode: string,
        message: string,
        public readonly authenticationError?: string,
    ) {
        super(message);
        this.name = 'ShopApiError';
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

export function isMissingStorefrontCatalogSchema(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
        error.message.includes('Unknown type "StorefrontCatalogInput"') ||
        error.message.includes('Cannot query field "storefrontCatalog"')
    );
}

export function catalogVariants(product: Product, input: StorefrontCatalogInput): Product['variants'] {
    if (!input.fulfillmentType) return product.variants;
    return product.variants.filter(variant => variant.customFields.fulfillmentType === input.fulfillmentType);
}

export function minimumCatalogPrice(product: Product, input: StorefrontCatalogInput): number {
    const prices = catalogVariants(product, input).map(variant => variant.priceWithTax);
    return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

export function matchesCatalogFilters(product: Product, input: StorefrontCatalogInput): boolean {
    const variants = catalogVariants(product, input);
    if (!variants.length) return false;
    if (input.inStockOnly && !variants.some(variant => !productAvailability(variant).soldOut)) {
        return false;
    }
    const minimumPrice = Math.min(...variants.map(variant => variant.priceWithTax));
    if (input.minPriceWithTax != null && minimumPrice < input.minPriceWithTax) return false;
    if (input.maxPriceWithTax != null && minimumPrice > input.maxPriceWithTax) return false;
    return true;
}

export function sortNativeCatalogProducts(
    products: Product[],
    input: StorefrontCatalogInput,
    locale: string,
): Product[] {
    const sorted = [...products];
    if (input.sort === 'sales') return sorted;
    if (input.sort === 'newest') {
        return sorted.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    }
    if (input.sort === 'price-asc' || input.sort === 'price-desc') {
        const direction = input.sort === 'price-asc' ? 1 : -1;
        return sorted.sort(
            (left, right) =>
                (minimumCatalogPrice(left, input) - minimumCatalogPrice(right, input)) * direction,
        );
    }
    return sorted.sort((left, right) => left.name.localeCompare(right.name, locale));
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
    const url = new URL(API_URL, window.location.href);
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
