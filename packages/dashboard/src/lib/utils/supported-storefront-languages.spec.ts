import { describe, expect, it } from 'vitest';

import {
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
});
