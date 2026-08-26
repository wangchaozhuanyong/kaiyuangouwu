import { describe, expect, it } from 'vitest';

import {
    contentSourceLanguageCode,
    dashboardContentLanguage,
    isSupportedStorefrontLanguage,
    supportedStorefrontLanguageCodes,
    supportedStorefrontLanguages,
} from './supported-storefront-languages.js';

describe('supported storefront languages', () => {
    it('keeps only English and Simplified Chinese', () => {
        expect(supportedStorefrontLanguageCodes).toEqual(['en', 'zh_Hans']);
        expect(supportedStorefrontLanguages(['de', 'en', 'zh_Hant', 'zh_Hans', 'ja'])).toEqual([
            'en',
            'zh_Hans',
        ]);
        expect(isSupportedStorefrontLanguage('zh_Hant')).toBe(false);
        expect(isSupportedStorefrontLanguage('zh_Hans')).toBe(true);
        expect(isSupportedStorefrontLanguage('en')).toBe(true);
        expect(isSupportedStorefrontLanguage('de')).toBe(false);
    });

    it('uses Simplified Chinese as the Dashboard source even for an English-default store', () => {
        expect(contentSourceLanguageCode).toBe('zh_Hans');
        expect(dashboardContentLanguage(['en', 'zh_Hans'], 'en')).toBe('zh_Hans');
        expect(dashboardContentLanguage(['en'], 'en')).toBe('en');
    });
});
