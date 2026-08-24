import { Injectable } from '@nestjs/common';
import { UserInputError } from '@vendure/core';
import { load } from 'cheerio';
import MarkdownIt from 'markdown-it';

import { StorefrontPromotionContentType } from '../types';

import { DEFAULT_PROMOTION_TEMPLATE, DEFAULT_PROMOTION_TEMPLATE_VERSION } from './default-promotion-template';

export const MAX_PROMOTION_SOURCE_BYTES = 60_000;

export interface StorefrontPromotionBindings {
    'store.name': string;
    'store.description': string;
    'store.logoUrl': string;
    'store.heroImageUrl': string;
    'store.currentYear': string;
    'store.language': string;
}

interface RenderPromotionInput {
    contentType: StorefrontPromotionContentType;
    source: string;
    bindings: StorefrontPromotionBindings;
    entryTicket: string;
    canonicalUrl?: string | null;
}

const MARKDOWN_SHELL = `<!doctype html>
<html lang="{{store.language}}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{store.name}}</title>
    <style>
        :root { color-scheme: light dark; --bg: #f4f7f6; --panel: #e4ebe8; --text: #18201d; --muted: #53605b; --accent: #276b58; --button: #f7fbf9; }
        * { box-sizing: border-box; }
        body {
            min-width: 320px; min-height: 100dvh; margin: 0;
            background: var(--bg); color: var(--text);
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .markdown-shell { width: min(100% - 36px, 820px); margin: 0 auto; padding: clamp(24px, 6vw, 72px) 0; }
        .markdown-brand { display: flex; align-items: center; gap: 12px; margin-bottom: clamp(42px, 8vw, 92px); }
        .markdown-brand img { width: 44px; height: 44px; border-radius: 14px; object-fit: contain; background: var(--panel); }
        .markdown-content { font-size: clamp(16px, 2vw, 19px); line-height: 1.72; }
        .markdown-content h1 { max-width: 14ch; margin: 0 0 28px; font-size: clamp(42px, 8vw, 78px); letter-spacing: -0.055em; line-height: 1; text-wrap: balance; }
        .markdown-content h2 { margin-top: 2em; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.035em; }
        .markdown-content img { display: block; max-width: 100%; height: auto; border-radius: 16px; }
        .markdown-content a { color: var(--accent); }
        .markdown-entry { margin-top: 42px; }
        .markdown-entry button {
            min-height: 54px; padding: 0 28px; border: 0; border-radius: 16px;
            background: var(--accent); color: var(--button); font: inherit; font-weight: 720; cursor: pointer;
        }
        .markdown-entry button:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
        @media (max-width: 600px) { .markdown-entry button { width: 100%; } }
        @media (prefers-color-scheme: dark) { :root { --bg: #111714; --panel: #202925; --text: #edf3f0; --muted: #abb8b2; --accent: #79bda7; --button: #10221c; } }
    </style>
</head>
<body>
    <main class="markdown-shell">
        <header class="markdown-brand">
            <img data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}">
            <strong data-bind-text="store.name"></strong>
        </header>
        <article class="markdown-content">{{promotion.markdown}}</article>
        <form class="markdown-entry" data-store-entry><button type="submit">进入主网站</button></form>
    </main>
</body>
</html>`;

const FALLBACK_ENTRY_FORM = `<form data-store-entry style="position:fixed;right:18px;bottom:18px;z-index:2147483647">
    <button type="submit" style="min-height:50px;padding:0 22px;border:0;border-radius:14px;background:#276b58;color:#f7fbf9;font:600 16px system-ui;cursor:pointer">
        进入主网站
    </button>
</form>`;

const PROMOTION_ACCESSIBILITY_STYLE = `<style data-storefront-promotion-accessibility>
    :where(a[href], button, [tabindex]:not([tabindex="-1"])):focus-visible {
        outline: 3px solid #38bdf8;
        outline-offset: 3px;
    }
</style>`;

@Injectable()
export class StorefrontPromotionHtmlService {
    private readonly markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

    get defaultTemplate(): string {
        return DEFAULT_PROMOTION_TEMPLATE;
    }

    get defaultTemplateVersion(): number {
        return DEFAULT_PROMOTION_TEMPLATE_VERSION;
    }

    validateSource(contentType: StorefrontPromotionContentType, source: string): string {
        if (contentType !== 'HTML' && contentType !== 'MARKDOWN') {
            throw new UserInputError('推广页格式无效');
        }
        const normalized = source.trim();
        if (!normalized) {
            throw new UserInputError('推广页内容不能为空');
        }
        if (Buffer.byteLength(normalized, 'utf8') > MAX_PROMOTION_SOURCE_BYTES) {
            throw new UserInputError('推广页源码不能超过 60 KB');
        }
        return normalized;
    }

    render(input: RenderPromotionInput): string {
        const source =
            input.contentType === 'MARKDOWN'
                ? MARKDOWN_SHELL.replace('{{promotion.markdown}}', this.markdown.render(input.source))
                : input.source;
        const withTokens = this.replaceTokens(source, input.bindings);
        const $ = load(withTokens, { xml: false });

        this.sanitizeDocument($);
        this.applyBindings($, input.bindings);
        this.normalizeEntryForm($, input.entryTicket);
        this.normalizeHead($, input.bindings, input.canonicalUrl);

        const document = $.html().replace(/^<!doctype html>\s*/iu, '');
        return `<!doctype html>\n${document}`;
    }

    private sanitizeDocument($: ReturnType<typeof load>): void {
        $('script, iframe, object, embed, base, noscript, template, svg, math').remove();
        $('link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"]').remove();
        $('meta[http-equiv]').each((_index, element) => {
            const value = ($(element).attr('http-equiv') ?? '').toLowerCase();
            if (value === 'refresh' || value === 'content-security-policy') {
                $(element).remove();
            }
        });

        $('*').each((_index, element) => {
            const node = $(element);
            const attributes =
                'attribs' in element
                    ? (element.attribs as Record<string, string>)
                    : ({} as Record<string, string>);
            for (const [name, value] of Object.entries(attributes)) {
                const normalizedName = name.toLowerCase();
                if (
                    normalizedName.startsWith('on') ||
                    normalizedName === 'srcdoc' ||
                    normalizedName === 'formaction'
                ) {
                    node.removeAttr(name);
                    continue;
                }
                if (normalizedName === 'style') {
                    node.attr(name, this.sanitizeCss(value));
                    continue;
                }
                if (['href', 'src', 'poster', 'background', 'action'].includes(normalizedName)) {
                    if (!this.isSafeUrl(value, normalizedName === 'src' || normalizedName === 'poster')) {
                        node.removeAttr(name);
                    }
                }
            }
        });

        $('style').each((_index, element) => {
            $(element).text(this.sanitizeCss($(element).html() ?? ''));
        });
        $('input, textarea, select').remove();

        $('form').each((_index, element) => {
            const form = $(element);
            if (form.attr('data-store-entry') !== undefined) {
                return;
            }
            form.replaceWith(form.contents());
        });
    }

    private applyBindings($: ReturnType<typeof load>, bindings: StorefrontPromotionBindings): void {
        $('[data-bind-text]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-text') as keyof StorefrontPromotionBindings | undefined;
            const value = key ? bindings[key] : undefined;
            if (value == null) return;
            if (!value && node.attr('data-hide-if-empty') !== undefined) {
                node.remove();
            } else {
                node.text(value);
            }
        });
        $('[data-bind-src]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-src') as keyof StorefrontPromotionBindings | undefined;
            const value = key ? bindings[key] : undefined;
            if (!value && node.attr('data-hide-if-empty') !== undefined) {
                node.remove();
            } else if (value && this.isSafeUrl(value, true)) {
                node.attr('src', value);
            }
        });
        $('[data-bind-background]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-background') as keyof StorefrontPromotionBindings | undefined;
            const value = key ? bindings[key] : undefined;
            if (!value && node.attr('data-hide-if-empty') !== undefined) {
                node.remove();
            } else if (value && this.isSafeUrl(value, true)) {
                const current = this.sanitizeCss(node.attr('style') ?? '');
                node.attr('style', `${current};background-image:url("${value.replace(/["\\]/g, '')}")`);
            }
        });
    }

    private normalizeEntryForm($: ReturnType<typeof load>, entryTicket: string): void {
        let forms = $('form[data-store-entry]');
        if (forms.length === 0) {
            $('body').append(FALLBACK_ENTRY_FORM);
            forms = $('form[data-store-entry]');
        }
        forms.each((_index, element) => {
            const form = $(element);
            form.attr('method', 'post');
            form.attr('action', '/promo/enter');
            form.removeAttr('target');
            if (form.find('input[name="ticket"]').length === 0) {
                form.prepend(`<input type="hidden" name="ticket" value="${this.escapeHtml(entryTicket)}">`);
            }
            if (form.find('button[type="submit"], input[type="submit"]').length === 0) {
                form.append('<button type="submit">进入主网站</button>');
            }
        });
    }

    private normalizeHead(
        $: ReturnType<typeof load>,
        bindings: StorefrontPromotionBindings,
        canonicalUrl?: string | null,
    ): void {
        $('html').attr('lang', bindings['store.language'] || 'en');
        if ($('head').length === 0) {
            $('html').prepend('<head></head>');
        }
        if ($('meta[charset]').length === 0) {
            $('head').prepend('<meta charset="utf-8">');
        }
        $('meta[name="viewport"]').remove();
        $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1">');
        $('style[data-storefront-promotion-accessibility]').remove();
        $('head').append(PROMOTION_ACCESSIBILITY_STYLE);
        $('meta[name="robots"]').remove();
        $('head').append('<meta name="robots" content="index,follow,max-image-preview:large">');
        if ($('title').length === 0) {
            $('head').append(`<title>${this.escapeHtml(bindings['store.name'])}</title>`);
        }
        $('link[rel="canonical"]').remove();
        if (canonicalUrl && this.isSafeUrl(canonicalUrl, false)) {
            $('head').append(`<link rel="canonical" href="${this.escapeHtml(canonicalUrl)}">`);
        }
    }

    private replaceTokens(source: string, bindings: StorefrontPromotionBindings): string {
        return source.replace(
            /{{\s*(store\.(?:name|description|logoUrl|heroImageUrl|currentYear|language))\s*}}/g,
            (_match, key: keyof StorefrontPromotionBindings) => this.escapeHtml(bindings[key] ?? ''),
        );
    }

    private sanitizeCss(value: string): string {
        return value
            .replace(/@import\s+[^;]+;?/gi, '')
            .replace(/expression\s*\([^)]*\)/gi, '')
            .replace(/(?:javascript|vbscript)\s*:/gi, '')
            .replace(/data\s*:\s*text\/html/gi, '')
            .replace(/(?:behavior|-moz-binding)\s*:[^;}]+[;}]?/gi, '');
    }

    private isSafeUrl(value: string, allowDataImage: boolean): boolean {
        const normalized = value
            .trim()
            .replace(/[\u0000-\u001f\u007f\s]+/g, '')
            .toLowerCase();
        if (
            !normalized ||
            normalized.startsWith('#') ||
            normalized.startsWith('/') ||
            normalized.startsWith('./') ||
            normalized.startsWith('../')
        ) {
            return true;
        }
        if (allowDataImage && /^data:image\/(?:png|gif|jpe?g|webp);base64,/.test(normalized)) {
            return true;
        }
        return (
            normalized.startsWith('https://') ||
            normalized.startsWith('http://') ||
            normalized.startsWith('mailto:') ||
            normalized.startsWith('tel:')
        );
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>"']/g, character => {
            const entities: Record<string, string> = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            };
            return entities[character];
        });
    }
}
