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
        expect(service.defaultTemplate).toContain('min-height:100dvh');
        expect(service.defaultTemplate).toContain('Damatong');
        expect(service.defaultTemplate).toContain('data-promo-header');
        expect(service.defaultTemplate).toContain('data-promo-motion');
        expect(service.defaultTemplate).toContain('data-promo-reveal');
        expect(service.defaultTemplate).toContain('promo-capability-channels');
        expect(service.defaultTemplate).toContain('promo-process-path');
        expect(service.defaultTemplate).toContain('promo-faq-item');
        expect(service.defaultTemplate).toContain('data-promo-carousel');
        expect(service.defaultTemplate).toContain('promo-hero-art');
        expect(service.defaultTemplate.match(/data-promo-slide role/g)).toHaveLength(3);
        expect(service.defaultTemplate.match(/data-promo-slide-button=/g)).toHaveLength(3);
        expect(service.defaultTemplate).not.toContain('data-promo-value-item');
        expect(service.defaultTemplate).not.toContain('promo-value-module');
        expect(service.defaultTemplate).not.toContain('data-promo-progress');
        expect(service.defaultTemplate).not.toContain('data-promo-carousel-toggle');
        expect(service.defaultTemplate).toContain('{{promo.metaTitle}}');
        expect(service.defaultTemplate).toContain('{{promo.finalTitle}}');
        expect(service.defaultTemplate).toContain('--amber:#efa83f');
        expect(service.defaultTemplate).toContain('Silver Mist');
        expect(service.defaultTemplate).toContain('damatong-silver-stage-v23.webp');
        expect(service.defaultTemplate).toContain('damatong-silver-stage-mobile-v23.webp');
        expect(service.defaultTemplate).toContain('damatong-amber-mark-v15.webp');
        expect(service.defaultTemplate).not.toContain('damatong-obsidian-field-v15.webp');
        expect(service.defaultTemplate).not.toContain('damatong-lunar-amber-v15.webp');
        expect(service.defaultTemplate).toContain('data-store-entry');
        expect(service.defaultTemplate).toContain('promo-mobile-entry');
        expect(service.defaultTemplate).toContain('prefers-reduced-motion:reduce');
        expect(service.defaultTemplate).toContain('.promo-hero { min-height:auto; }');
        expect(service.defaultTemplate).toContain('.promo-hero-inner { min-height:0; padding:68px 0 18px; }');
        expect(service.defaultTemplate).not.toContain('min-height:max(720px,calc(100svh - 64px))');
        expect(service.defaultTemplate).not.toContain('min-width:320px');
        expect(service.defaultTemplate).not.toContain('.promo-value-rail');
        expect(service.defaultTemplate).not.toContain('<canvas');
        expect(service.defaultTemplate).not.toContain('data-promo-signal-canvas');
        expect(service.defaultTemplate).not.toContain('promo-visual-canvas');
        expect(service.defaultTemplate).toContain('--section-top:clamp(76px,6.4vw,108px)');
        expect(service.defaultTemplate).toContain('--section-bottom:clamp(56px,4.8vw,82px)');
        expect(service.defaultTemplate).toContain('--section-top:48px; --section-bottom:32px');
        expect(service.defaultTemplate).toContain(
            '.promo-section-title { max-width:15ch; margin-inline:auto;',
        );
        expect(service.defaultTemplate).toContain('.promo-final h2 { max-width:15ch; margin-inline:auto;');
        expect(service.defaultTemplate).toContain(
            '.promo-footer { min-height:0; align-items:center; justify-content:center;',
        );
        expect(service.defaultTemplate).toContain(
            'padding:30px 0 48px; border-top:1px solid var(--line); text-align:center;',
        );
        expect(service.defaultTemplate).toContain(
            '.promo-footer-meta,.promo-footer-nav { width:100%; justify-content:center; }',
        );
        expect(service.defaultTemplate).toContain('.promo-faq-item.is-faq-closing summary::after');
        expect(service.defaultTemplateVersion).toBe(23);
        expect(Buffer.byteLength(service.defaultTemplate, 'utf8')).toBeLessThan(MAX_PROMOTION_SOURCE_BYTES);
        expect(Buffer.byteLength(service.defaultTemplate, 'utf8')).toBeLessThanOrEqual(58 * 1024);
    });

    it('renders a crawl-safe business introduction without live catalog data', () => {
        const html = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).toContain('Damatong');
        expect(html).toContain('AI 效率工具');
        expect(html).toContain('AI 服务订阅');
        expect(html).toContain('低至 0.1 倍起');
        expect(html).toContain('不同模型、通道与当前价格以服务中心为准');
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
        expect(englishHtml).toContain('AI usage credits');
        expect(englishHtml).toContain('Entrepreneurship');
        expect(englishHtml).toContain('Coverage across workflows');
        expect(englishHtml).not.toContain('Token credits');
        expect(englishHtml).not.toContain('查看可用服务');
        expect(englishHtml).not.toContain('服务能力');
        expect(englishHtml).not.toContain('{{promo.');
        expect(chineseHtml).toContain('AI 数字服务');
        expect(chineseHtml).toContain('查看可用服务');
        expect(chineseHtml).toContain('AI 服务订阅');
        expect(chineseHtml).toContain('低至 0.1 倍起');
        expect(chineseHtml).toContain('个人创业');
        expect(chineseHtml).toContain('覆盖多种工作场景');
        expect(chineseHtml).not.toContain('View available services');
        expect(chineseHtml).not.toContain('SERVICE CAPABILITIES');
        expect(chineseHtml).not.toContain('AI Digital Services');
        expect(chineseHtml).not.toContain('Token');
        expect(chineseHtml).not.toContain('TKN');
        expect(chineseHtml).not.toContain('TOOL');
        expect(chineseHtml).not.toContain('Assistant');
        expect(chineseHtml).not.toContain('Coding');
        expect(chineseHtml).not.toContain('Creative');
        expect(chineseHtml).not.toContain('{{promo.');
    });

    it('appends only the trusted motion controller to pages that opt into promotion motion', () => {
        const html = service.render({
            contentType: 'HTML',
            source: service.defaultTemplate,
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html.match(/data-storefront-promotion-visual/g)).toHaveLength(1);
        expect(html).toContain(PROMOTION_VISUAL_SCRIPT);
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('${JSON.stringify');
        expect(PROMOTION_VISUAL_SCRIPT).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
        expect(PROMOTION_VISUAL_SCRIPT).toContain("page.setAttribute('data-promo-motion-state','ready')");
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain("getContext('2d'");
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('webgl');
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('canvas');
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain("addEventListener('scroll'");
        expect(PROMOTION_VISUAL_SCRIPT).toContain('const slideInterval=3000');
        expect(PROMOTION_VISUAL_SCRIPT).toContain('carouselTimer=setTimeout');
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('updateProgress');
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('updateToggle');
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('interactionPaused');
        expect(PROMOTION_VISUAL_SCRIPT).toContain('const animateFaq=(item,opening)=>');
        expect(PROMOTION_VISUAL_SCRIPT).toContain("duration:340,easing:'cubic-bezier(.22,1,.36,1)'");
        expect(PROMOTION_VISUAL_SCRIPT).toContain("typeof Element.prototype.animate!=='function'");
        expect(PROMOTION_VISUAL_SCRIPT).not.toContain('valueItems');
        expect(PROMOTION_VISUAL_SCRIPT).toContain(
            "carouselNav.addEventListener('keydown',handleCarouselKeys)",
        );
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

    it('keeps the bundled Damatong campaign art independent from optional store imagery', () => {
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

        expect(withLogo).toContain('class="promo-brand-mark"');
        expect(withoutLogo).toContain('class="promo-brand-mark"');
        expect(withoutLogo).toContain('data-promo-motion');
        expect(withoutLogo).toContain('/storefront/promo/damatong-silver-stage-v23.webp');
        expect(withoutLogo).toContain('/storefront/promo/damatong-silver-stage-mobile-v23.webp');
        expect(withoutLogo).toContain('/storefront/promo/damatong-amber-mark-v15.webp');
        expect(withoutLogo).not.toContain('<canvas');
        expect(withoutLogo).toContain('<picture class="promo-hero-art"');
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
