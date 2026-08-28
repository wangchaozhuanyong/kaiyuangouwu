import { setupI18n } from '@lingui/core';
import { describe, expect, it, vi } from 'vitest';

import { translateNavTitle } from './nav-title.js';

describe('translateNavTitle', () => {
    it('translates a title that exists in the active catalog', () => {
        const i18n = setupI18n({
            locale: 'zh_Hans',
            messages: { zh_Hans: { Products: '商品' } },
        });

        expect(translateNavTitle(i18n, 'Products')).toBe('商品');
    });

    it('returns an extension title unchanged without asking Lingui to compile it', () => {
        const i18n = setupI18n({ locale: 'zh_Hans', messages: { zh_Hans: {} } });
        const translate = vi.spyOn(i18n, 't');

        expect(translateNavTitle(i18n, 'AI 服务接入')).toBe('AI 服务接入');
        expect(translate).not.toHaveBeenCalled();
    });
});
