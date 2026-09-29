import { describe, expect, it } from 'vitest';

import { storefrontClientPreviewUrl, storefrontPreviewShopApiUrl } from './storefront-client-preview-url';

describe('real storefront draft preview URL', () => {
    it('opens the selected unsaved skin in the storefront preview without changing the saved config', () => {
        expect(storefrontClientPreviewUrl('https://shop.example.test/', 'neo-minimalist', 1440)).toBe(
            'https://shop.example.test/__storefront-preview?preset=neo-minimalist&viewport=1440',
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

describe('selected store Shop API routing', () => {
    const domain = (
        name: string,
        channelId = 'shop',
        status: 'ACTIVE' | 'PENDING' = 'ACTIVE',
        isPrimary = false,
    ) => ({
        domain: name,
        channel: { id: channelId, code: channelId },
        status,
        isPrimary,
    });
    it('prefers the ACTIVE primary domain and excludes another Channel and unverified domains', () => {
        expect(
            storefrontPreviewShopApiUrl(
                [
                    domain('other.example.test', 'other', 'ACTIVE', true),
                    domain('pending.example.test', 'shop', 'PENDING', true),
                    domain('alias.example.test'),
                    domain('primary.example.test', 'shop', 'ACTIVE', true),
                ],
                'shop',
            ),
        ).toBe('https://primary.example.test/shop-api');
        expect(storefrontPreviewShopApiUrl([domain('alias.example.test')], 'shop')).toBe(
            'https://alias.example.test/shop-api',
        );
    });
    it('fails closed without an ACTIVE domain belonging to the selected Channel', () => {
        expect(storefrontPreviewShopApiUrl(undefined, 'shop')).toBeNull();
        expect(storefrontPreviewShopApiUrl([domain('other.example.test', 'other')], 'shop')).toBeNull();
        expect(
            storefrontPreviewShopApiUrl([domain('pending.example.test', 'shop', 'PENDING')], 'shop'),
        ).toBeNull();
    });
    it.each([
        'bad/host',
        'store.example.test:444',
        'user@store.example.test',
        'https://store.example.test',
        'store.example.test?x=1',
    ])('rejects non-host domain metadata (%s)', value => {
        expect(storefrontPreviewShopApiUrl([domain(value)], 'shop')).toBeNull();
    });
});
