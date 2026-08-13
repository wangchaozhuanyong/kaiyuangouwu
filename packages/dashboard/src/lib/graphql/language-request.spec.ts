import { describe, expect, it } from 'vitest';

import { addDashboardLanguageParams } from './language-request.js';

describe('addDashboardLanguageParams', () => {
    it.each([
        {
            name: '中文界面 + 中文内容',
            settings: { displayLanguage: 'zh_Hans', contentLanguage: 'zh_Hans' },
            expected: { displayLanguageCode: 'zh_Hans', languageCode: 'zh_Hans' },
        },
        {
            name: '英文界面 + 英文内容',
            settings: { displayLanguage: 'en', contentLanguage: 'en' },
            expected: { displayLanguageCode: 'en', languageCode: 'en' },
        },
        {
            name: '中文界面 + 英文内容',
            settings: { displayLanguage: 'zh_Hans', contentLanguage: 'en' },
            expected: { displayLanguageCode: 'zh_Hans', languageCode: 'en' },
        },
        {
            name: '英文界面 + 中文内容',
            settings: { displayLanguage: 'en', contentLanguage: 'zh_Hans' },
            expected: { displayLanguageCode: 'en', languageCode: 'zh_Hans' },
        },
    ])('$name keeps display and content language independent', ({ settings, expected }) => {
        const url = new URL(addDashboardLanguageParams('http://localhost/admin-api', settings));

        expect(Object.fromEntries(url.searchParams)).toEqual(expected);
    });

    it('uses an explicit display-language override for configuration metadata queries', () => {
        const url = new URL(
            addDashboardLanguageParams(
                'http://localhost/admin-api',
                { displayLanguage: 'en', contentLanguage: 'zh_Hans' },
                'zh_Hans',
            ),
        );

        expect(Object.fromEntries(url.searchParams)).toEqual({
            displayLanguageCode: 'zh_Hans',
            languageCode: 'zh_Hans',
        });
    });
});
