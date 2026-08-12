import { describe, expect, it } from 'vitest';

import { getPreferredLocaleForLanguage } from './use-display-locale.js';

describe('getPreferredLocaleForLanguage', () => {
    it('uses China for Chinese display languages', () => {
        expect(getPreferredLocaleForLanguage('zh_Hans')).toBe('CN');
        expect(getPreferredLocaleForLanguage('zh-Hant')).toBe('CN');
    });

    it('uses Malaysia for English display languages', () => {
        expect(getPreferredLocaleForLanguage('en')).toBe('MY');
        expect(getPreferredLocaleForLanguage('en_GB')).toBe('MY');
    });

    it('does not impose a locale on other languages', () => {
        expect(getPreferredLocaleForLanguage('fr')).toBeUndefined();
    });
});
