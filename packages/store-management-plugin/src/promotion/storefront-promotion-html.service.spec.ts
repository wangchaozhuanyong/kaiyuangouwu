import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { PROMOTION_VISUAL_SCRIPT, PROMOTION_VISUAL_SCRIPT_SHA256 } from './promotion-visual-script';
import {
    MAX_PROMOTION_SOURCE_BYTES,
    StorefrontPromotionBindings,
    StorefrontPromotionHtmlService,
} from './storefront-promotion-html.service';

const bindings: StorefrontPromotionBindings = {
    'store.name': '测试商店 <b>',
    'store.description': '店铺简介',
    'store.logoUrl': 'https://shop.example.com/assets/preview/logo.png?format=webp',
    'store.heroImageUrl': 'https://shop.example.com/assets/preview/hero.jpg?format=webp',
    'store.shareImageUrl': 'https://shop.example.com/assets/source/referral-share.jpg',
    'store.shareTitle': '邀请好友，一起发现好物',
    'store.shareDescription': '专注数字服务与便捷消费',
    'store.currentYear': '2026',
    'store.language': 'zh-CN',
    'store.featuredProduct1Id': '101',
    'store.featuredProduct1Name': 'AI 接口月度方案',
    'store.featuredProduct1Description': '适合个人项目的按月服务方案',
    'store.featuredProduct1PriceLabel': '¥39.00 起',
    'store.featuredProduct1ImageUrl': 'https://shop.example.com/assets/preview/product-1.jpg?format=webp',
    'store.featuredProduct2Id': '102',
    'store.featuredProduct2Name': '生产力软件订阅',
    'store.featuredProduct2Description': '常用软件订阅与授权',
    'store.featuredProduct2PriceLabel': '¥69.00 起',
    'store.featuredProduct2ImageUrl': '',
    'store.featuredProduct3Id': '',
    'store.featuredProduct3Name': '',
    'store.featuredProduct3Description': '',
    'store.featuredProduct3PriceLabel': '',
    'store.featuredProduct3ImageUrl': '',
};

describe('StorefrontPromotionHtmlService', () => {
    const service = new StorefrontPromotionHtmlService();

    it('removes active content and keeps only the signed store entry form', () => {
        const html = service.render({
            contentType: 'HTML',
            source: `<!doctype html><html><head>
                <link rel="stylesheet" href="https://evil.example/style.css">
                <script>alert(1)</script>
            </head><body onload="alert(1)">
                <iframe src="https://evil.example"></iframe>
                <a href="javascript:alert(1)">bad</a>
                <form action="https://evil.example"><input name="secret"><button>bad form</button></form>
                <h1 data-bind-text="store.name"></h1>
                <form data-store-entry action="https://evil.example" target="_blank"><button type="submit">进入</button></form>
            </body></html>`,
            bindings,
            entryTicket: 'signed-ticket',
            canonicalUrl: 'https://shop.example.com/promo',
        });

        expect(html).not.toMatch(/<script|<iframe|onload=|javascript:|evil\.example\/style/u);
        expect(html.match(/<!doctype html>/giu)).toHaveLength(1);
        expect(html).not.toContain('name="secret"');
        expect(html).toContain('<h1 data-bind-text="store.name">测试商店 &lt;b&gt;</h1>');
        expect(html).toContain('method="post"');
        expect(html).toContain('action="/promo/enter"');
        expect(html).toContain('name="ticket" value="signed-ticket"');
        expect(html.match(/data-store-entry/g)).toHaveLength(1);
    });

    it('does not execute HTML embedded in Markdown', () => {
        const html = service.render({
            contentType: 'MARKDOWN',
            source: '# 欢迎\n\n<script>alert(1)</script>\n\n{{store.name}}',
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).toContain('<h1>欢迎</h1>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('测试商店 &lt;b&gt;');
    });

    it('provides a responsive default page with semantic store bindings', () => {
        expect(service.defaultTemplate).toContain('min-height: 100dvh');
        expect(service.defaultTemplate).toContain('data-bind-src="store.logoUrl"');
        expect(service.defaultTemplate).toContain('data-promo-signal-stage');
        expect(service.defaultTemplate).toContain('data-promo-signal-canvas');
        expect(service.defaultTemplate).toContain('data-promo-signal-core-logo');
        expect(service.defaultTemplate).toContain('data-store-entry');
        expect(service.defaultTemplateVersion).toBe(7);
        expect(Buffer.byteLength(service.defaultTemplate, 'utf8')).toBeLessThan(MAX_PROMOTION_SOURCE_BYTES);
    });

    it('renders real product bindings and normalizes product entry destinations', () => {
        const html = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).toContain('AI 接口月度方案');
        expect(html).toContain('¥39.00 起');
        expect(html).toContain('name="destination" value="product:101"');
        expect(html).toContain('src="https://shop.example.com/assets/preview/product-1.jpg');
        expect(html).not.toContain('store.featuredProduct3Name');
        expect(html).not.toContain('商品正在整理中');
    });

    it('shows an honest empty state when no featured products are available', () => {
        const html = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings: {
                ...bindings,
                'store.featuredProduct1Id': '',
                'store.featuredProduct1Name': '',
                'store.featuredProduct1Description': '',
                'store.featuredProduct1PriceLabel': '',
                'store.featuredProduct1ImageUrl': '',
                'store.featuredProduct2Id': '',
                'store.featuredProduct2Name': '',
                'store.featuredProduct2Description': '',
                'store.featuredProduct2PriceLabel': '',
                'store.featuredProduct2ImageUrl': '',
            },
            entryTicket: 'signed-ticket',
        });

        expect(html).toContain('商品正在整理中');
        expect(html).not.toContain('<article class="promo-product-card');
    });

    it('appends only the trusted renderer to pages that opt into the signal canvas', () => {
        const html = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html.match(/data-storefront-promotion-visual/g)).toHaveLength(1);
        expect(html).toContain(PROMOTION_VISUAL_SCRIPT);
        expect(html).toContain('进入主站选软件');

        const renderedScript = html.match(
            /<script data-storefront-promotion-visual="">([\s\S]*?)<\/script>/u,
        )?.[1];
        expect(renderedScript).toBe(PROMOTION_VISUAL_SCRIPT);
        expect(
            createHash('sha256')
                .update(renderedScript ?? '')
                .digest('base64'),
        ).toBe(PROMOTION_VISUAL_SCRIPT_SHA256);
    });

    it('uses the store logo as the signal core and keeps the renderer when no logo is available', () => {
        const withLogo = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings,
            entryTicket: 'signed-ticket',
        });
        const withoutLogo = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings: { ...bindings, 'store.logoUrl': '' },
            entryTicket: 'signed-ticket',
        });

        expect(withLogo.match(/data-promo-signal-core-logo/g)).toHaveLength(1);
        expect(withoutLogo).not.toContain('data-promo-signal-core-logo');
        expect(withoutLogo).toContain('data-promo-signal-canvas');
    });

    it('normalizes custom page zoom and keyboard focus accessibility', () => {
        const html = service.render({
            contentType: 'HTML',
            source: `<!doctype html><html><head>
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
            </head><body><form data-store-entry><button type="submit">进入</button></form></body></html>`,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).toContain('content="width=device-width, initial-scale=1"');
        expect(html).not.toContain('maximum-scale');
        expect(html).not.toContain('user-scalable');
        expect(html).toContain('data-storefront-promotion-accessibility');
        expect(html).toContain(':focus-visible');
        expect(html).toContain('<meta http-equiv="X-UA-Compatible" content="IE=edge">');
        expect(html).toContain('<meta name="renderer" content="webkit">');
    });

    it('keeps the browser icons synchronized with the current store logo', () => {
        const html = service.render({
            contentType: 'HTML',
            source: `<!doctype html><html><head>
                <link rel="icon" href="https://old.example/favicon.ico">
                <link rel="apple-touch-icon" href="https://old.example/apple-touch-icon.png">
            </head><body><form data-store-entry><button type="submit">进入</button></form></body></html>`,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).not.toContain('old.example');
        expect(html).toContain(
            '<link rel="icon" href="https://shop.example.com/assets/preview/logo.png?format=webp&amp;preset=storefront-original-preview&amp;q=75">',
        );
        expect(html).toContain(
            '<link rel="apple-touch-icon" href="https://shop.example.com/assets/preview/logo.png?format=webp&amp;preset=storefront-original-preview&amp;q=75">',
        );
    });

    it('forces the configured referral share image into Open Graph metadata', () => {
        const html = service.render({
            contentType: 'HTML',
            source: `<!doctype html><html><head>
                <meta property="og:image" content="https://old.example/hero.jpg">
            </head><body><form data-store-entry><button type="submit">进入</button></form></body></html>`,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).not.toContain('old.example/hero.jpg');
        expect(html).toContain(
            '<meta property="og:image" content="https://shop.example.com/assets/source/referral-share.jpg?preset=storefront-original-preview&amp;format=webp&amp;q=75">',
        );
        expect(html).toContain('name="twitter:image"');
        expect(html).toContain('<meta property="og:title" content="邀请好友，一起发现好物">');
        expect(html).toContain('<meta property="og:description" content="专注数字服务与便捷消费">');
    });

    it('removes third-party images and rewrites managed assets to WebP', () => {
        const html = service.render({
            contentType: 'HTML',
            source: `<!doctype html><html><body>
                <img src="https://images.example.com/hero.jpg" alt="external">
                <img src="https://images.example.com/assets/fake.png" alt="fake asset">
                <img src="/assets/preview/hero.png" alt="managed">
                <form data-store-entry><button type="submit">进入</button></form>
            </body></html>`,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).not.toContain('images.example.com');
        expect(html).toContain(
            'src="/assets/preview/hero.png?preset=storefront-original-preview&amp;format=webp&amp;q=75"',
        );
    });
});
