import { describe, expect, it } from 'vitest';

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
