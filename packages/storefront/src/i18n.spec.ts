import { describe, expect, it } from 'vitest';

import {
    defaultStorefrontLanguageFor,
    languageCodeFor,
    localeFor,
    marketCodeForChannel,
    markets,
    resolveStorefrontLanguage,
    supportedStorefrontLanguages,
} from './i18n';

describe('storefront market configuration', () => {
    it('uses the active regional Channel as the client market', () => {
        expect(marketCodeForChannel('cn-mainland')).toBe('cn-mainland');
        expect(marketCodeForChannel('my-malaysia')).toBe('my-malaysia');
    });

    it('does not apply regional defaults to an unknown Channel', () => {
        expect(marketCodeForChannel('merchant-custom-channel')).toBeNull();
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
