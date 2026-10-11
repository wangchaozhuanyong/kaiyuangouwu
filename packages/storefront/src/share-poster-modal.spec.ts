// organize-imports-ignore -- Preserve ESLint type groups.
import type { Product } from './types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SharePosterSurface } from './components/common/share-poster-surface';
import { createQrCodeSvgDataUrl } from './share-poster-modal';

describe('share poster QR code', () => {
    it('creates a local SVG data URL without a network image request', async () => {
        const dataUrl = await createQrCodeSvgDataUrl('https://moyaoai.com/#/product/1');
        const svg = decodeURIComponent(dataUrl.split(',', 2)[1]);

        expect(dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
        expect(svg).toContain('<svg');
        expect(svg).toContain('shape-rendering="crispEdges"');
    });
});

describe('shared poster waiting surface', () => {
    const product = {
        id: 'local',
        name: '本地商品',
        featuredAsset: null,
        assets: [],
        variants: [],
    } as unknown as Product;
    it('shows known content and reserves the QR slot before the export module arrives', () => {
        const pending = renderToStaticMarkup(
            SharePosterSurface({
                product,
                storefrontName: '本地合成数据',
                logoUrl: null,
                language: 'zh',
                formattedPrice: '¥10',
                pending: true,
            }),
        );
        const ready = renderToStaticMarkup(
            SharePosterSurface({
                product,
                storefrontName: '本地合成数据',
                logoUrl: null,
                language: 'zh',
                formattedPrice: '¥10',
                qrCodeUrl: 'data:image/svg+xml,<svg></svg>',
            }),
        );
        for (const html of [pending, ready]) {
            expect(html).toContain('poster-preview-wrapper');
            expect(html).toContain('poster-image-box');
            expect(html).toContain('poster-actions-row');
            expect(html).toContain('class="poster-qrcode"');
            expect(html).toContain('本地商品');
        }
        expect(pending.match(/disabled=""/g)).toHaveLength(2);
        expect(ready).not.toContain('disabled=""');
        expect(pending).toContain('role="status"');
    });
});
