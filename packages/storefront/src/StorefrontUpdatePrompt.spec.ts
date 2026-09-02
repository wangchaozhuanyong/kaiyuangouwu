import { describe, expect, it } from 'vitest';
import { readStorefrontStylesheet } from './test-stylesheet';

import { getStorefrontUpdateCopy } from './StorefrontUpdatePrompt';

const stylesheet = readStorefrontStylesheet();

describe('StorefrontUpdatePrompt', () => {
    it('uses one language throughout the update notice', () => {
        expect(getStorefrontUpdateCopy('zh')).toEqual({
            title: '发现新版本',
            description: '刷新即可使用最新内容',
            action: '立即刷新',
        });
        expect(getStorefrontUpdateCopy('en')).toEqual({
            title: 'Update available',
            description: 'Refresh to use the latest version',
            action: 'Refresh now',
        });
    });

    it('sets explicit readable colors for update notice text', () => {
        expect(stylesheet).toMatch(/\.storefront-update-prompt strong\s*{[\s\S]*?color: var\(--text\)/);
        expect(stylesheet).toMatch(/\.storefront-update-prompt span\s*{[\s\S]*?color: var\(--muted\)/);
    });
});
