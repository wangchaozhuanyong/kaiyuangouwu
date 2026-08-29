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
        expect(service.defaultTemplate).toContain('Damatong');
        expect(service.defaultTemplate).toContain('data-promo-header');
        expect(service.defaultTemplate).toContain('data-promo-signal-stage');
        expect(service.defaultTemplate).toContain('data-promo-signal-canvas');
        expect(service.defaultTemplate).toContain('promo-network-core');
        expect(service.defaultTemplate).toContain('data-promo-surface');
        expect(service.defaultTemplate).toContain('data-promo-reveal');
        expect(service.defaultTemplate).toContain('promo-capability-mark');
        expect(service.defaultTemplate).toContain('promo-timeline');
        expect(service.defaultTemplate).toContain('promo-faq-item');
        expect(service.defaultTemplate).toContain('{{promo.metaTitle}}');
        expect(service.defaultTemplate).toContain('{{promo.finalTitle}}');
        expect(service.defaultTemplate).toContain('--faint: #728198');
        expect(service.defaultTemplate).toContain('data-store-entry');
        expect(service.defaultTemplate).toContain('promo-mobile-entry');
        expect(service.defaultTemplateVersion).toBe(12);
        expect(Buffer.byteLength(service.defaultTemplate, 'utf8')).toBeLessThan(MAX_PROMOTION_SOURCE_BYTES);
    });

    it('renders a crawl-safe business introduction without live catalog data', () => {
        const html = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).toContain('Damatong');
        expect(html).toContain('AI 工具');
        expect(html).toContain('AI 订阅服务');
        expect(html).toContain('少花时间筛选');
        expect(html).toContain('查看可用服务');
        expect(html).toContain('可以直接在这里完成购买或交易吗');
        expect(html.match(/推广页只用于介绍服务方向/gu)).toHaveLength(1);
        expect(html).toContain('content="index,nofollow,max-image-preview:large"');
        expect(html).not.toContain('云桥');
        expect(html).not.toContain('CloudBridge');
        expect(html).not.toContain('推广介绍层');
        expect(html).not.toContain('主站业务层');
        expect(html).not.toContain('不展示商品列表');
        expect(html).not.toContain('featuredProduct');
        expect(html).not.toContain('data-bind-entry-product');
        expect(html).not.toContain('name="destination" value="product:');
    });

    it('renders the default page as one language at a time', () => {
        const englishHtml = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings: {
                ...bindings,
                'store.name': 'Damatong',
                'store.description': 'AI digital services',
                'store.shareTitle': 'Explore AI services',
                'store.shareDescription': 'Clear AI digital services for every workflow',
                'store.language': 'en',
            },
            entryTicket: 'signed-ticket',
        });
        const chineseHtml = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(englishHtml).toContain('AI Digital Services');
        expect(englishHtml).toContain('View available services');
        expect(englishHtml).toContain('AI subscriptions');
        expect(englishHtml).not.toContain('查看可用服务');
        expect(englishHtml).not.toContain('服务能力');
        expect(englishHtml).not.toContain('{{promo.');
        expect(chineseHtml).toContain('AI 数字服务');
        expect(chineseHtml).toContain('查看可用服务');
        expect(chineseHtml).toContain('AI 订阅服务');
        expect(chineseHtml).not.toContain('View available services');
        expect(chineseHtml).not.toContain('SERVICE CAPABILITIES');
        expect(chineseHtml).not.toContain('Token');
        expect(chineseHtml).not.toContain('TKN');
        expect(chineseHtml).not.toContain('TOOL');
        expect(chineseHtml).not.toContain('Assistant');
        expect(chineseHtml).not.toContain('Coding');
        expect(chineseHtml).not.toContain('Creative');
        expect(chineseHtml).not.toContain('{{promo.');
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
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('${JSON.stringify');
        expect(html).toContain('Damatong');

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

    it('keeps the Damatong network core independent from optional store imagery', () => {
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

        expect(withLogo).toContain('class="promo-network-core"');
        expect(withoutLogo).toContain('class="promo-network-core"');
        expect(withoutLogo).toContain('data-promo-signal-canvas');
        expect(withoutLogo).toContain('Damatong');
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
