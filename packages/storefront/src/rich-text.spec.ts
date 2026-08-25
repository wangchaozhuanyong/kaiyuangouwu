import { describe, expect, it } from 'vitest';

import { productDescriptionText, sanitizeProductDescription } from './rich-text';

describe('product description rich text', () => {
    it('keeps supported formatting from the admin rich-text editor', () => {
        const result = sanitizeProductDescription(
            '<p>适合 <strong>日常使用</strong></p><ul><li>支付后交付</li></ul>',
        );

        expect(result).toBe('<p>适合 <strong>日常使用</strong></p><ul><li>支付后交付</li></ul>');
    });

    it('removes executable markup and unsafe attributes', () => {
        const result = sanitizeProductDescription(
            '<script>alert(1)</script><p onclick="alert(2)">安全内容</p><a href="javascript:alert(3)">链接</a>',
        );

        expect(result).not.toContain('alert');
        expect(result).not.toContain('onclick');
        expect(result).not.toContain('javascript:');
        expect(result).toContain('<p>安全内容</p>');
    });

    it('rewrites uploaded rich-text images to WebP detail presets', () => {
        const result = sanitizeProductDescription(
            '<p><img src="/assets/preview/detail.png?token=public" alt="详情图" loading="lazy"></p>',
        );

        expect(result).toContain('preset=storefront-detail-1200');
        expect(result).toContain('format=webp');
        expect(result).toContain('q=75');
        expect(result).toContain('token=public');
    });

    it('removes third-party bitmap URLs instead of loading them directly', () => {
        const result = sanitizeProductDescription(
            '<p>商品说明<img src="https://images.example.com/detail.jpg" alt="外链图片"></p>',
        );

        expect(result).toBe('<p>商品说明</p>');
        expect(result).not.toContain('images.example.com');
    });

    it('keeps same-origin SVG illustrations as the vector exception', () => {
        expect(sanitizeProductDescription('<img src="/storefront/guide.svg" alt="说明">')).toBe(
            '<img src="/storefront/guide.svg" alt="说明">',
        );
    });

    it('creates readable plain text for summaries and sharing', () => {
        expect(productDescriptionText('<p>ChatGPT &amp; AI</p><p>支付后交付</p>')).toBe(
            'ChatGPT & AI 支付后交付',
        );
    });
});
