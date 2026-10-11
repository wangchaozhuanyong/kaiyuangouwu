import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
    renderPublicSeoHead,
    serializeStorefrontPageData,
    type StorefrontPageData,
} from '@vendure/storefront-content-plugin';
import { load } from 'cheerio';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

type Renderer = { renderPublicPage(page: StorefrontPageData): Promise<string> };
const loadRenderer = createRequire(__filename);

/** Replaces metadata without disturbing the matching artifact's styles, icons or script entry. */
export function assemblePublicHtml(
    template: string,
    page: StorefrontPageData,
    body: string,
    styles: string[] = [],
): string {
    const seo = page.seo;
    if (!seo) throw new Error('Missing public SEO resolution');
    const head = renderPublicSeoHead(seo);
    const html = template
        .replace(/<title\b[^>]*>[\s\S]*?<\/title>/giu, '')
        .replace(
            /<meta\b[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/giu,
            '',
        )
        .replace(/<link\b[^>]*rel=["'](?:canonical|alternate)["'][^>]*>/giu, '')
        .replace(/<!--#\s*include[\s\S]*?-->/gu, '')
        .replace(
            /<html\b([^>]*)>/iu,
            (_match, attrs: string) =>
                `<html${attrs.replace(/\s+lang=["'][^"']*["']/iu, '')} lang="${seo.languageCode === 'zh_Hans' ? 'zh-CN' : 'en'}">`,
        )
        .replace('</head>', `${head}\n</head>`);
    const document = load(html);
    if (document('#root').length !== 1 || !document('script[type="module"][src]').length)
        throw new Error('Invalid storefront artifact shell');
    for (const style of styles) {
        if (!/^[a-zA-Z0-9_-]+\.css$/u.test(style)) throw new Error('Invalid public stylesheet');
        document('head').append(`<link rel="stylesheet" href="/assets/${style}">`);
    }
    document('#root').attr('data-public-rendered', '1').html(body);
    // React's hoisted resource belongs before the common desktop overrides,
    // including on the server's first response before hydration can run.
    const homeStyle = document('style[data-href="storefront-home-showcase"]');
    const commonStyle = document('head link[rel="stylesheet"]').first();
    if (homeStyle.length) {
        if (commonStyle.length) commonStyle.before(homeStyle);
        else document('head').append(homeStyle);
    }
    document('#storefront-public-page-data').remove();
    document('body').append(
        `<script type="application/json" id="storefront-public-page-data">${serializeStorefrontPageData(page)}</script>`,
    );
    return document.html();
}

@Injectable()
export class StorefrontSeoHtmlService {
    private lastRendererPath?: string;

    private artifactRoot(): string {
        // Operational deployment pointer, never a merchant presentation choice.
        const active = '/var/www/kaiyuangouwu-storefront-current';
        const local = resolve(__dirname, '../../../storefront/dist');
        return existsSync(active) ? realpathSync(active) : local;
    }

    async render(page: StorefrontPageData): Promise<string> {
        try {
            const root = this.artifactRoot();
            const rendererPath = realpathSync(resolve(root, '.server/public-page-renderer.cjs'));
            if (this.lastRendererPath && this.lastRendererPath !== rendererPath)
                delete loadRenderer.cache[this.lastRendererPath];
            const renderer = loadRenderer(rendererPath) as Renderer;
            this.lastRendererPath = rendererPath;
            const template = await readFile(resolve(root, 'index.html'), 'utf8');
            const prefixes =
                page.request?.kind === 'product'
                    ? ['product-detail-page-']
                    : page.request?.kind === 'catalog'
                      ? [
                            'account-catalog-surfaces-',
                            ...(page.request.path === '/search' ? ['search-page-'] : []),
                        ]
                      : [];
            const styles = prefixes.length
                ? (await readdir(resolve(root, 'assets'))).filter(
                      file => file.endsWith('.css') && prefixes.some(prefix => file.startsWith(prefix)),
                  )
                : [];
            if (prefixes.some(prefix => !styles.some(file => file.startsWith(prefix))))
                throw new Error('Missing public route stylesheet');
            const body = await renderer.renderPublicPage(page);
            if (!body.trim()) throw new Error('Public renderer produced empty HTML');
            return assemblePublicHtml(template, page, body, styles);
        } catch {
            // A broken/missing render artifact is temporary, never an indexable empty 200 page.
            throw new ServiceUnavailableException('Public storefront rendering is temporarily unavailable');
        }
    }
}
