import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    compactUiCopy,
    defaultStorefrontLanguageFor,
    detectSystemLanguage,
    documentLanguageFor,
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

describe('compact storefront copy', () => {
    it('uses standard customer-facing order terms instead of literal translations', () => {
        expect(compactUiCopy.en.orders).toMatchObject({
            unpaid: 'Unpaid',
            processing: 'Processing',
            shipped: 'Shipped',
            returns: 'Returns',
            all: 'All',
        });
    });

    it('keeps icon-grid labels within the agreed compact copy budget', () => {
        const englishLabels = [
            ...Object.values(compactUiCopy.en.home),
            ...Object.values(compactUiCopy.en.trust),
            ...Object.values(compactUiCopy.en.services),
            compactUiCopy.en.orders.all,
            compactUiCopy.en.orders.unpaid,
            compactUiCopy.en.orders.processing,
            compactUiCopy.en.orders.shipped,
            compactUiCopy.en.orders.returns,
        ];

        expect(englishLabels.every(label => label.length <= 10 && !label.includes(' '))).toBe(true);
        expect(Object.values(compactUiCopy.zh.trust).every(label => Array.from(label).length <= 4)).toBe(
            true,
        );
    });
});

describe('storefront market configuration', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses browser-recognizable document language tags', () => {
        expect(documentLanguageFor('zh')).toBe('zh-CN');
        expect(documentLanguageFor('en')).toBe('en');
    });

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
