import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    defaultStorefrontLanguageFor,
    detectSystemLanguage,
    languageCodeFor,
    languageFromPrimaryTag,
    localeFor,
    marketForStorefrontConfig,
    markets,
    parseManualStorefrontLanguagePreference,
    resolveStorefrontLanguage,
    serializeManualStorefrontLanguagePreference,
    supportedStorefrontLanguages,
} from './i18n';

describe('storefront market configuration', () => {
    afterEach(() => vi.unstubAllGlobals());

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

    it('detects system language and falls back correctly', () => {
        expect(resolveStorefrontLanguage(markets['cn-mainland'], 'en')).toBe('en');
        expect(resolveStorefrontLanguage(markets['my-malaysia'], 'zh')).toBe('zh');
        expect(resolveStorefrontLanguage(markets['cn-mainland'], 'ms')).toBe(
            defaultStorefrontLanguageFor(markets['cn-mainland']),
        );
        expect(resolveStorefrontLanguage(markets['my-malaysia'], 'ms')).toBe(
            defaultStorefrontLanguageFor(markets['my-malaysia']),
        );
    });

    it.each([
        ['zh-CN', ['zh-CN', 'en-US'], 'zh'],
        ['zh-TW', ['zh-TW', 'en-US'], 'zh'],
        ['en-US', ['en-US', 'zh-CN'], 'en'],
        ['ms-MY', ['ms-MY', 'zh-CN', 'en-US'], 'en'],
        ['ja-JP', ['ja-JP', 'zh-CN', 'en-US'], 'en'],
    ] as const)('uses only the primary system language %s', (language, languages, expected) => {
        vi.stubGlobal('navigator', { language, languages });
        expect(detectSystemLanguage()).toBe(expected);
    });

    it('normalizes Chinese language tags and otherwise uses English', () => {
        expect(languageFromPrimaryTag('zh-HK')).toBe('zh');
        expect(languageFromPrimaryTag('zh_SG')).toBe('zh');
        expect(languageFromPrimaryTag('en-US')).toBe('en');
        expect(languageFromPrimaryTag('', 'zh')).toBe('zh');
    });

    it('accepts only the versioned manual language preference', () => {
        expect(
            parseManualStorefrontLanguagePreference(serializeManualStorefrontLanguagePreference('zh')),
        ).toBe('zh');
        expect(parseManualStorefrontLanguagePreference('en')).toBeNull();
        expect(parseManualStorefrontLanguagePreference('{"version":1,"language":"zh"}')).toBeNull();
    });
});
