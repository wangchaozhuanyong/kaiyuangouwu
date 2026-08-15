import { describe, expect, it } from 'vitest';

import {
    defaultStorefrontLanguageFor,
    languageCodeFor,
    localeFor,
    marketForStorefrontConfig,
    markets,
    resolveStorefrontLanguage,
    supportedStorefrontLanguages,
} from './i18n';

describe('storefront market configuration', () => {
    it('uses runtime Channel configuration for an arbitrary store', () => {
        expect(
            marketForStorefrontConfig({
                code: 'software-store',
                defaultLanguageCode: 'en',
                defaultCurrencyCode: 'MYR',
                availableCountries: [{ code: 'MY', name: 'Malaysia' }],
                customFields: {},
            }),
        ).toMatchObject({
            code: 'software-store',
            defaultLanguageCode: 'en',
            currencyCode: 'MYR',
            countryCode: 'MY',
        });
    });

    it('formats English with the active market locale', () => {
        expect(localeFor('en', markets['cn-mainland'])).toBe('en-US');
        expect(localeFor('en', markets['my-malaysia'])).toBe('en-MY');
    });

    it('only offers Chinese and English', () => {
        expect(supportedStorefrontLanguages).toEqual(['zh', 'en']);
        expect(languageCodeFor('zh')).toBe('zh_Hans');
        expect(languageCodeFor('en')).toBe('en');
    });

    it('defaults mainland China to Chinese and Malaysia to English', () => {
        expect(defaultStorefrontLanguageFor(markets['cn-mainland'])).toBe('zh');
        expect(defaultStorefrontLanguageFor(markets['my-malaysia'])).toBe('en');
    });

    it('keeps a valid market preference and rejects unsupported languages', () => {
        expect(resolveStorefrontLanguage(markets['cn-mainland'], 'en')).toBe('en');
        expect(resolveStorefrontLanguage(markets['my-malaysia'], 'zh')).toBe('zh');
        expect(resolveStorefrontLanguage(markets['cn-mainland'], 'ms')).toBe('zh');
        expect(resolveStorefrontLanguage(markets['my-malaysia'], 'ms')).toBe('en');
    });
});
