import {
    parseManualStorefrontLanguagePreference,
    resolveStorefrontLanguage,
    serializeManualStorefrontLanguagePreference,
} from './i18n';
import { scopedStorageKey } from './storefront-storage';
import { MarketConfig, Product, StorefrontLanguage } from './types';

export { productImage } from './product-media';

export const STOREFRONT_NAME_MAX_DISPLAY_UNITS = 16;
export const FAVORITE_PRODUCT_STORAGE_KEY = 'storefront-favorite-product-ids';
export const RECENT_PRODUCT_STORAGE_KEY = 'storefront-recent-product-ids';
export const STOREFRONT_LANGUAGE_PREFERENCE_STORAGE_KEY = 'storefront-language-preference-v2';
export const STOREFRONT_CURRENCY_PREFERENCE_STORAGE_KEY = 'storefront-currency-preference-v1';
export const STOREFRONT_SETTLEMENT_CURRENCY_PREFERENCE_STORAGE_KEY =
    'storefront-settlement-currency-preference-v1';
export const FAVORITE_PRODUCT_LIMIT = 100;
export const RECENT_PRODUCT_LIMIT = 20;

export const DEFAULT_STOREFRONT_NAMES: Record<StorefrontLanguage, string> = {
    zh: 'MOYAO AI｜模钥',
    en: 'MOYAO AI',
};

export function storefrontNameDisplayUnits(value: string): number {
    return Array.from(value).reduce((total, character) => {
        const isWideCharacter = /[\p{Script=Han}\uFF01-\uFF60]/u.test(character);
        return total + (isWideCharacter ? 2 : 1);
    }, 0);
}

export function normalizeStorefrontName(value: string | null | undefined, fallback: string): string {
    const normalized = value?.trim() ?? '';
    if (!normalized || storefrontNameDisplayUnits(normalized) > STOREFRONT_NAME_MAX_DISPLAY_UNITS) {
        return fallback;
    }
    return normalized;
}

export function readStoredLanguage(market: MarketConfig): StorefrontLanguage {
    try {
        const manualPreference = parseManualStorefrontLanguagePreference(
            localStorage.getItem(scopedStorageKey(STOREFRONT_LANGUAGE_PREFERENCE_STORAGE_KEY, market.code)),
        );
        return resolveStorefrontLanguage(market, manualPreference);
    } catch {
        return resolveStorefrontLanguage(market, null);
    }
}

export function writeManualLanguage(marketCode: string, language: StorefrontLanguage): void {
    try {
        localStorage.setItem(
            scopedStorageKey(STOREFRONT_LANGUAGE_PREFERENCE_STORAGE_KEY, marketCode),
            serializeManualStorefrontLanguagePreference(language),
        );
    } catch {
        // A disabled localStorage must not prevent language changes.
    }
}

export function readStoredCurrency(market: MarketConfig, available?: readonly string[]): string {
    try {
        const stored = localStorage.getItem(
            scopedStorageKey(STOREFRONT_CURRENCY_PREFERENCE_STORAGE_KEY, market.code),
        );
        if (stored && (!available || available.includes(stored))) return stored;
    } catch {
        // A disabled localStorage must not prevent the storefront from loading.
    }
    return available?.includes(market.currencyCode)
        ? market.currencyCode
        : (available?.[0] ?? market.currencyCode);
}

export function writeStoredCurrency(marketCode: string, currencyCode: string): void {
    try {
        localStorage.setItem(
            scopedStorageKey(STOREFRONT_CURRENCY_PREFERENCE_STORAGE_KEY, marketCode),
            currencyCode,
        );
    } catch {
        // The in-memory choice still works for this page lifetime.
    }
}

export function readStoredSettlementCurrency(market: MarketConfig, available?: readonly string[]): string {
    try {
        const stored = localStorage.getItem(
            scopedStorageKey(STOREFRONT_SETTLEMENT_CURRENCY_PREFERENCE_STORAGE_KEY, market.code),
        );
        if (stored && stored !== 'USDT' && (!available || available.includes(stored))) return stored;
    } catch {
        // A disabled localStorage must not prevent the storefront from loading.
    }
    return available?.includes(market.currencyCode)
        ? market.currencyCode
        : (available?.[0] ?? market.currencyCode);
}

export function writeStoredSettlementCurrency(marketCode: string, currencyCode: string): void {
    if (currencyCode === 'USDT') return;
    try {
        localStorage.setItem(
            scopedStorageKey(STOREFRONT_SETTLEMENT_CURRENCY_PREFERENCE_STORAGE_KEY, marketCode),
            currencyCode,
        );
    } catch {
        // The in-memory choice still works for this page lifetime.
    }
}

export function setMetaContent(selector: string, content: string): void {
    document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content);
}

export function minimumProductPrice(product: Product): number {
    return Math.min(...product.variants.map(variant => variant.priceWithTax), Number.MAX_SAFE_INTEGER);
}

export function trimText(value: string | undefined, length: number): string {
    if (!value) return '';
    const clean = value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

export function contentNumberSetting(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function contentStringArraySetting(value: unknown): string[] {
    return Array.isArray(value)
        ? Array.from(
              new Set(value.flatMap(item => (typeof item === 'string' && item.trim() ? [item.trim()] : []))),
          )
        : [];
}
