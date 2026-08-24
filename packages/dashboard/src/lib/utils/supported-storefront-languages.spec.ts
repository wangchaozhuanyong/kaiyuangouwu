import { describe, expect, it } from 'vitest';

import {
    isSupportedStorefrontLanguage,
    supportedStorefrontLanguages,
} from './supported-storefront-languages.js';

describe('supported storefront languages', () => {
    it('keeps current storefront languages and removes Traditional Chinese', () => {
        expect(supportedStorefrontLanguages(['en', 'zh_Hant', 'zh_Hans'])).toEqual(['en', 'zh_Hans']);
        expect(isSupportedStorefrontLanguage('zh_Hant')).toBe(false);
        expect(isSupportedStorefrontLanguage('zh_Hans')).toBe(true);
    });
});
