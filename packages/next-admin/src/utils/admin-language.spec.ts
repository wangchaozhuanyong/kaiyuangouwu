import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAdminDisplayLanguage, normalizeAdminDisplayLanguage } from './admin-language';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Admin display language', () => {
    it.each([
        ['zh-CN', 'zh_Hans'],
        ['zh_Hans', 'zh_Hans'],
        ['en-US', 'en'],
        ['en', 'en'],
    ])('normalizes %s to %s', (input, expected) => {
        expect(normalizeAdminDisplayLanguage(input)).toBe(expected);
    });

    it('prefers the explicit page language over the HTML and browser languages', () => {
        vi.stubGlobal('window', { location: { search: '?displayLanguageCode=en-GB' } });
        vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } });
        vi.stubGlobal('navigator', { language: 'zh-CN' });

        expect(getAdminDisplayLanguage()).toBe('en');
    });

    it('uses the HTML language for the ordinary Admin entry point', () => {
        vi.stubGlobal('window', { location: { search: '' } });
        vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } });
        vi.stubGlobal('navigator', { language: 'en-US' });

        expect(getAdminDisplayLanguage()).toBe('zh_Hans');
    });
});
