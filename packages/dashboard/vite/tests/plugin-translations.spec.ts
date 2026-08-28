import { setupI18n } from '@lingui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileMessageCatalog } from '../vite-plugin-translations.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('plugin translation compilation', () => {
    it('loads static plugin translations without an uncompiled-message warning', () => {
        const messages = compileMessageCatalog('zh_Hans', {
            'operations.stores.orders': '订单量',
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const i18n = setupI18n({
            locale: 'zh-Hans',
            messages: { 'zh-Hans': messages },
        });

        expect(messages['operations.stores.orders']).toEqual(['订单量']);
        expect(i18n._('operations.stores.orders')).toBe('订单量');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('preserves ICU plural behavior in compiled plugin translations', () => {
        const messages = compileMessageCatalog('en', {
            'operations.stores.orderCount': '{count, plural, one {# order} other {# orders}}',
        });
        const i18n = setupI18n({ locale: 'en', messages: { en: messages } });

        expect(i18n._('operations.stores.orderCount', { count: 1 })).toBe('1 order');
        expect(i18n._('operations.stores.orderCount', { count: 2 })).toBe('2 orders');
    });

    it('fails compilation with the locale and invalid message id', () => {
        expect(() =>
            compileMessageCatalog('en', {
                'operations.stores.invalid': '{count, plural, one {One}',
            }),
        ).toThrow(/en[\s\S]*operations\.stores\.invalid/);
    });
});
