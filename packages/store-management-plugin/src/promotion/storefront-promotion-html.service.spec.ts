import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';

import {
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

    it('preserves scroll behavior and following responsive rules while stripping unsafe CSS properties', () => {
        const css = `html{scroll-behavior:smooth;scroll-padding-top:100px}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important}}
@media(max-width:900px){.header{display:grid}}
.legacy{behavior:url(/assets/legacy.htc);color:red;-moz-binding:url(/assets/legacy.xml)}
.after{display:block}`;
        const html = service.render({
            contentType: 'HTML',
            source: `<html><head><style>${css}</style></head><body><p style="scroll-behavior:auto;BEHAVIOR:url(/assets/legacy.htc);color:red">Safe</p></body></html>`,
            bindings,
            entryTicket: 'test-ticket',
        });
        const $ = load(html);
        const cleaned = $('style').first().text();

        expect(cleaned).toContain('html{scroll-behavior:smooth;scroll-padding-top:100px}');
        expect(cleaned).toContain(
            '@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important}}',
        );
        expect(cleaned).toContain('@media(max-width:900px){.header{display:grid}}');
        expect(cleaned).toContain('.legacy{color:red;}');
        expect(cleaned).toContain('.after{display:block}');
        expect(cleaned.match(/\{/g)?.length).toBe(cleaned.match(/\}/g)?.length);
        expect(cleaned).not.toContain('legacy.htc');
        expect(cleaned).not.toContain('-moz-binding');
        expect($('p').attr('style')).toBe('scroll-behavior:auto;color:red');
    });

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

    it('replaces stale or duplicate entry ticket fields with the current signed ticket', () => {
        const html = service.render({
            contentType: 'HTML',
            source: `<!doctype html><html><body>
                <form data-store-entry>
                    <input type="hidden" name="ticket" value="stale-ticket">
                    <input type="text" name="ticket" value="duplicate-ticket">
                    <button type="submit">进入</button>
                </form>
            </body></html>`,
            entryTicket: 'current-signed-ticket',
            bindings,
        });

        const $ = load(html);
        const tickets = $('form[data-store-entry] input[name="ticket"]');
        expect(tickets).toHaveLength(1);
        expect(tickets.attr('type')).toBe('hidden');
        expect(tickets.attr('value')).toBe('current-signed-ticket');
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

    it('renders the shared unconfigured page without a store-specific campaign', () => {
        const html = service.render({
            contentType: 'MARKDOWN',
            source: '# {{store.name}}\n\n{{store.description}}',
            bindings,
            entryTicket: 'signed-ticket',
        });

        expect(html).toContain('测试商店 &lt;b&gt;');
        expect(html).toContain('店铺简介');
        expect(html).toContain('data-store-entry');
        expect(html).not.toContain('MOYAO AI');
        expect(html).not.toContain('moyao-ai-network-stage');
    });

    it('uses neutral entry text when the editor has not supplied a label', () => {
        const zh = service.render({
            contentType: 'MARKDOWN',
            source: '# {{store.name}}',
            bindings,
            entryTicket: 'signed-ticket',
        });
        const en = service.render({
            contentType: 'MARKDOWN',
            source: '# {{store.name}}',
            bindings: { ...bindings, 'store.language': 'en' },
            entryTicket: 'signed-ticket',
        });
        expect(zh).toContain('>进入店铺</button>');
        expect(en).toContain('>Enter store</button>');
        expect(zh).not.toContain('进入服务中心');
        expect(en).not.toContain('Enter service center');
    });

    it('rejects unpublished legacy promo tokens before a stale draft can go live', () => {
        expect(() => service.validateSource('HTML', '<h1>{{promo.heroLead}}</h1>')).toThrow(
            '旧版推广页占位符已停用',
        );
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
