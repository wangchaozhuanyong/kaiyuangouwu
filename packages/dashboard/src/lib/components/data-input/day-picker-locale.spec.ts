import type { Locale } from 'date-fns/locale';
import { describe, expect, it, vi } from 'vitest';

import { getDayPickerLocaleCandidates, loadDayPickerLocale } from './day-picker-locale.js';

describe('getDayPickerLocaleCandidates', () => {
    it.each([
        ['zh-Hans', ['zh-CN', 'zh']],
        ['zh-Hant', ['zh-TW', 'zh']],
        ['pt_BR', ['pt-BR', 'pt']],
        ['fa', ['fa-IR', 'fa']],
        ['en', ['en']],
    ])('maps %s to supported locale candidates', (tag, expected) => {
        expect(getDayPickerLocaleCandidates(tag)).toEqual(expected);
    });
});

describe('loadDayPickerLocale', () => {
    it('loads the exact regional locale when available', async () => {
        const zhCN = { code: 'zh-CN' } as Locale;
        const loadZhCN = vi.fn().mockResolvedValue({ zhCN });

        await expect(
            loadDayPickerLocale('zh-Hans', {
                'zh-CN': loadZhCN,
            }),
        ).resolves.toBe(zhCN);
        expect(loadZhCN).toHaveBeenCalledOnce();
    });

    it('falls back to the base language and returns undefined when unsupported', async () => {
        const french = { code: 'fr' } as Locale;
        const loadFrench = vi.fn().mockResolvedValue({ fr: french });
        const loaders = { fr: loadFrench };

        await expect(loadDayPickerLocale('fr-CH', loaders)).resolves.toBe(french);
        await expect(loadDayPickerLocale('xx-YY', loaders)).resolves.toBeUndefined();
    });
});
