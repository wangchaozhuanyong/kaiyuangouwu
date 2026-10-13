import jsQR from 'jsqr';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { POSTER_QR_STYLES } from '../../common/src/referral-poster-design';

import { createCircularQrSvg } from './poster-qr';

describe('circular QR exported image decoding', () => {
    const urls = [
        'https://moyaoai.com/',
        'https://moyaoai.com/register?ref=ABCD2345&source=POSTER',
        'https://shop.flashcast.com.my/register?ref=X7W89H4Q&source=POSTER',
        'https://damatong.net/products/example-furniture-set?variant=9999',
        'http://127.0.0.1:5368/e2e/artwork-poster/product.html?style=champagne&language=en',
        'https://long-store.example/products/a-product?variant=123&ref=ABCD2345',
    ];
    for (const style of POSTER_QR_STYLES) {
        it(`${style.id} decodes the original URL at full size and after resizing/JPEG compression`, async () => {
            for (const url of urls) {
                for (const diameter of [456, 480]) {
                    const svg = Buffer.from(createCircularQrSvg(url, style.id, diameter));
                    for (const width of [diameter, diameter / 2]) {
                        const jpg = await sharp(svg)
                            .resize(width, width)
                            .flatten({ background: '#ffffff' })
                            .jpeg({ quality: 75 })
                            .toBuffer();
                        const { data, info } = await sharp(jpg)
                            .ensureAlpha()
                            .raw()
                            .toBuffer({ resolveWithObject: true });
                        expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(url);
                    }
                }
            }
        });
    }
    it('rejects areas too small for a link instead of silently shrinking its modules', () => {
        expect(() => createCircularQrSvg(urls[1], 'minimal', 120)).toThrow('区域太小');
        expect(() => createCircularQrSvg('', 'minimal', 480)).toThrow('内容或尺寸无效');
    });
});
