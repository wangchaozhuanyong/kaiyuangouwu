import { isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';
import { describe, expect, it } from 'vitest';

import { createContentPublicationChecker, publishedContentItems } from './content-publication';

const status = createContentPublicationChecker(isUsableEnglishTranslation);
const now = Date.parse('2026-09-26T00:00:00Z');
const translations = [
    { languageCode: 'zh_Hans', title: '核心入口' },
    { languageCode: 'en', title: 'Core links' },
];
const item = {
    enabled: true,
    translations: [
        { languageCode: 'zh_Hans', label: '客服' },
        { languageCode: 'en', label: 'Support' },
    ],
};
const core = { type: 'CORE_CATEGORIES', enabled: true, translations, items: [item] };

describe('shared admin and Shop API publication contract', () => {
    it('uses saved card positions without reordering or removing Admin draft items', () => {
        const items = [
            { ...item, position: 40, translations: [] },
            { ...item, position: 30 },
            { ...item, position: 10, enabled: false },
            { ...item, position: 20 },
        ];
        const block = { ...core, items };
        expect(publishedContentItems(block)).toEqual([items[3], items[1]]);
        expect(block.items.map(value => value.position)).toEqual([40, 30, 10, 20]);
        expect(status(block, now, 'zh_Hans')).toBe('PUBLISHED');
        expect(status(block, now, 'en')).toBe('PUBLISHED');
    });
    it.each(['zh_Hans', 'en'])(
        'does not hide the two displayed core cards for incomplete extra cards in %s',
        language => {
            const block = {
                ...core,
                items: [
                    { ...item, enabled: false, translations: [] },
                    item,
                    item,
                    { ...item, translations: [] },
                ],
            };
            expect(status(block, now, language)).toBe('PUBLISHED');
            expect(
                status({ ...block, items: [item, { ...item, translations: [] }, item] }, now, language),
            ).toBe('INCOMPLETE_TRANSLATION');
            expect(status({ ...block, type: 'QUICK_LINKS' }, now, language)).toBe('INCOMPLETE_TRANSLATION');
        },
    );

    for (const language of ['zh_Hans', 'en']) {
        it.each([
            [{ ...core, items: [] }, 'MISSING_ITEMS'],
            [{ ...core, items: [{ ...item, enabled: false }] }, 'MISSING_ITEMS'],
            [{ ...core, enabled: false, items: [] }, 'DISABLED'],
            [{ ...core, startsAt: '2026-09-27T00:00:00Z' }, 'SCHEDULED'],
            [{ ...core, endsAt: '2026-09-26T00:00:00Z' }, 'EXPIRED'],
            [core, 'PUBLISHED'],
            [{ ...core, items: [item, { ...item, enabled: false, translations: [] }] }, 'PUBLISHED'],
        ] as Array<[Parameters<typeof status>[0], string]>)(
            'reports the publication reason in ' + language + ': %s',
            (block, expected) => {
                expect(status(block, now, language)).toBe(expected);
            },
        );
    }
    it('allows Chinese publication while English translation is pending', () => {
        const block = {
            ...core,
            translations: [translations[0]],
            items: [{ ...item, translations: [item.translations[0]] }],
        };
        expect(status(block, now, 'zh_Hans')).toBe('PUBLISHED');
        expect(status(block, now, 'en')).toBe('INCOMPLETE_TRANSLATION');
    });
    it.each(['COUPONS', 'FLASH_SALE', 'BEST_SELLERS', 'RECOMMENDATIONS', 'NOTICE', 'CUSTOM'])(
        'does not require manual cards for %s, whose data can be supplied separately',
        type => {
            expect(status({ ...core, type, items: [] }, now, 'zh_Hans')).toBe('PUBLISHED');
        },
    );
});
