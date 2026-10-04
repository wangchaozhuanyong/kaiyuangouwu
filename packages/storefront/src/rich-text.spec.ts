import { describe, expect, it } from 'vitest';

import { productDescriptionText, sanitizeProductDescription } from './rich-text';

describe('product description rich text', () => {
    it.each(['\n', '\r\n', '\r'])('preserves textarea line breaks and blank lines (%j)', newline => {
        const lines = [
            '使用说明及售后质保规则',
            '',
            '一、商品与服务说明',
            '1. 服务周期为一个月',
            '2. API 调用费用另计',
            '',
            '四、退款计算方式',
            '900÷30×（30－10）＝600元',
        ];
        expect(sanitizeProductDescription(lines.join(newline))).toBe(lines.join('<br>'));
    });

    it('keeps literal comparisons and placeholders in plain text', () => {
        expect(sanitizeProductDescription('额度 < 10 & 剩余 > 0\n请填写<账号>')).toBe(
            '额度 &lt; 10 &amp; 剩余 &gt; 0<br>请填写&lt;账号&gt;',
        );
    });

    it('preserves legacy block boundaries and list numbering', () => {
        const html = '<div>第一段</div><div>第二段</div><ol start="5"><li value="7">使用规则</li></ol>';
        expect(sanitizeProductDescription(html)).toBe(html);
        expect(productDescriptionText(html)).toBe('第一段 第二段 使用规则');
    });

    it('handles empty content without generating empty break markup', () => {
        for (const value of [null, undefined, '', '\n  \r\n']) {
            expect(sanitizeProductDescription(value)).toBe('');
        }
    });

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

        expect(result).toContain('preset=storefront-detail-1600');
        expect(result).toContain('format=webp');
        expect(result).toContain('q=90');
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

    it('keeps description text formatting while removing media and empty image paragraphs', () => {
        expect(sanitizeProductDescription('<p>First</p><p></p><p>Second</p>', { textOnly: true })).toBe(
            '<p>First</p><p></p><p>Second</p>',
        );
        expect(
            sanitizeProductDescription(
                '<h2>商品说明</h2><p>经典<strong>浓香</strong></p>' +
                    '<figure><img src="/assets/preview/detail.png"><figcaption>包装说明</figcaption></figure>' +
                    '<p><img src="/storefront/guide.svg"></p>' +
                    '<ul><li>净含量：500ml</li></ul>' +
                    '<video src="/assets/video.mp4">视频内容</video><iframe src="/player"></iframe>',
                { textOnly: true },
            ),
        ).toBe(
            '<h2>商品说明</h2><p>经典<strong>浓香</strong></p>' +
                '<figure><figcaption>包装说明</figcaption></figure><ul><li>净含量：500ml</li></ul>',
        );
        expect(
            sanitizeProductDescription('<figure><img src="/assets/preview/detail.png"></figure>', {
                textOnly: true,
            }),
        ).toBe('');
    });
});
