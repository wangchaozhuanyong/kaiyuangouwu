import { describe, expect, it } from 'vitest';

import { normalizeRichTextAssetSource } from './image-dialog.js';

describe('normalizeRichTextAssetSource', () => {
    it('stores selected Vendure assets as same-origin paths', () => {
        expect(
            normalizeRichTextAssetSource(
                'https://console.damatong.net/assets/source/detail.png?token=public',
                'https://console.damatong.net',
            ),
        ).toBe('/assets/source/detail.png?token=public');
        expect(
            normalizeRichTextAssetSource('/assets/source/detail.png', 'https://console.damatong.net'),
        ).toBe('/assets/source/detail.png');
    });

    it('rejects third-party files which are not served by the Vendure asset route', () => {
        expect(
            normalizeRichTextAssetSource(
                'https://images.example.com/detail.png',
                'https://console.damatong.net',
            ),
        ).toBe('');
        expect(
            normalizeRichTextAssetSource(
                'https://images.example.com/assets/detail.png',
                'https://console.damatong.net',
            ),
        ).toBe('');
    });
});
