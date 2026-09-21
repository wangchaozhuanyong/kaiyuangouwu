import { describe, expect, it } from 'vitest';

import { storefrontClientPreviewUrl } from './storefront-client-preview-url';

describe('real storefront draft preview URL', () => {
    it('opens the selected unsaved skin in the storefront preview without changing the saved config', () => {
        expect(storefrontClientPreviewUrl('https://shop.example.test/', 'modern-oriental', 1440)).toBe(
            'https://shop.example.test/__storefront-preview?preset=modern-oriental&viewport=1440',
        );
        expect(storefrontClientPreviewUrl('https://shop.example.test/', 'classic', 390, true)).toBe(
            'https://shop.example.test/?storefrontPreviewEmbedded=1&storefrontPreviewPreset=classic&storefrontPreviewAuth=guest&storefrontPreviewLanguage=zh',
        );
    });

    it.each(['', 'javascript:alert(1)', 'file:///etc/passwd', 'bad-url'])(
        'does not embed an invalid storefront URL (%s)',
        url => {
            expect(storefrontClientPreviewUrl(url, 'classic', 390)).toBeNull();
        },
    );
});
