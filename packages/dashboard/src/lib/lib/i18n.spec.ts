import { describe, expect, it } from 'vitest';

import { toBcp47Locale } from './i18n.js';

describe('toBcp47Locale', () => {
    it('converts Vendure language codes into valid Intl locale tags', () => {
        expect(toBcp47Locale('zh_Hans')).toBe('zh-Hans');
        expect(toBcp47Locale('pt_BR')).toBe('pt-BR');
        expect(toBcp47Locale('en-GB')).toBe('en-GB');
    });

    it('produces a locale accepted by Intl plural rules', () => {
        expect(new Intl.PluralRules(toBcp47Locale('zh_Hans')).select(2)).toBe('other');
    });
});
