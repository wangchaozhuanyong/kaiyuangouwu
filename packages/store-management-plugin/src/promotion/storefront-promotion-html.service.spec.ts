import { describe, expect, it } from 'vitest';

import {
    StorefrontPromotionBindings,
    StorefrontPromotionHtmlService,
} from './storefront-promotion-html.service';

const bindings: StorefrontPromotionBindings = {
    'store.name': '测试商店 <b>',
    'store.description': '店铺简介',
    'store.logoUrl': 'https://cdn.example.com/logo.png',
    'store.heroImageUrl': 'https://cdn.example.com/hero.jpg',
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
        expect(service.defaultTemplate).toContain('data-bind-src="store.logoUrl"');
        expect(service.defaultTemplate).toContain('data-bind-src="store.heroImageUrl"');
        expect(service.defaultTemplate).toContain('data-store-entry');
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
        expect(html).toContain('<link rel="icon" href="https://cdn.example.com/logo.png">');
        expect(html).toContain('<link rel="apple-touch-icon" href="https://cdn.example.com/logo.png">');
    });
});
