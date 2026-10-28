import { Injectable } from '@nestjs/common';
import {
    isStorefrontVisualPresetId,
    renderPublicSeoHead,
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    serializeStorefrontPageData,
    storefrontSkinCssVariables,
    type StorefrontPageData,
} from '@vendure/storefront-content-plugin';
import { load } from 'cheerio';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { measurePublicDocument, measurePublicDocumentSync } from '../performance/public-document-timing';
import { renderStorefrontIconLinks } from '../storefront-lcp-preload.service';

import { PublicHtmlRenderError, type PublicHtmlRenderStage } from './public-render-diagnostics';

type Renderer = {
    renderPublicPage(page: StorefrontPageData): Promise<string>;
    getPublicRouteScriptPreloads?(
        page: StorefrontPageData,
        assetNames: readonly string[],
        readSource: (file: string) => Promise<string>,
    ): string[] | Promise<string[]>;
};
const loadRenderer = createRequire(__filename);
const scriptAssetName = /^[\w-]+\.js$/u;

/** Replaces metadata without disturbing the matching artifact's styles, icons or script entry. */
export function assemblePublicHtml(
    template: string,
    page: StorefrontPageData,
    body: string,
    styles: string[] = [],
    scriptPreloads: string[] = [],
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
    const config = page.config as {
        code?: string;
        accessMode?: string;
        logoUrl?: string | null;
        brandBackgroundColor?: string | null;
        brandPrimaryColor?: string | null;
        brandAccentColor?: string | null;
        brandHighlightColor?: string | null;
    };
    // Public HTML removes the SSI fragment, so the already resolved Channel
    // must also supply its icons before the browser parses the document.
    const logoUrl =
        config.code && config.code === page.scope.channelCode && config.accessMode === 'LIVE'
            ? (config.logoUrl ?? null)
            : null;
    document('link[rel~="icon"], link[rel="apple-touch-icon"]').remove();
    document('head').prepend(renderStorefrontIconLinks(logoUrl));
    const presetId = page.visualPreset?.presetId;
    // The confirmed public facts own the first frame, just as they own hydration.
    // An absent/failed preset or a different Channel must leave the shell neutral.
    if (
        config.code &&
        config.code === page.scope.channelCode &&
        config.accessMode === 'LIVE' &&
        isStorefrontVisualPresetId(presetId) &&
        !page.failures?.includes('visualPreset')
    ) {
        const palette = resolveStorefrontSemanticPalette(presetId, {
            backgroundColor: config.brandBackgroundColor,
            primaryColor: config.brandPrimaryColor,
            accentColor: config.brandAccentColor,
            highlightColor: config.brandHighlightColor,
        });
        const colorScheme = presetId === 'neo-minimalist' ? 'dark' : 'light';
        const variables = {
            ...semanticPaletteCssVariables(palette),
            ...storefrontSkinCssVariables(presetId, palette),
            'color-scheme': colorScheme,
        };
        document('html')
            .attr('data-storefront-preset', presetId)
            .attr(
                'style',
                [
                    document('html').attr('style'),
                    ...Object.entries(variables).map(([name, value]) => `${name}:${value};`),
                ]
                    .filter(Boolean)
                    .join(';'),
            )
            .removeAttr('data-storefront-theme-pending');
        document('meta[name="theme-color"]').attr('content', palette.page);
        document('meta[name="color-scheme"]').attr('content', colorScheme);
    }
    for (const style of styles) {
        if (!/^[a-zA-Z0-9_-]+\.css$/u.test(style)) throw new Error('Invalid public stylesheet');
        document('head').append(`<link rel="stylesheet" href="/assets/${style}">`);
    }
    const linkedResources = new Set(
        document('script[src], link[href]')
            .map((_index, element) => document(element).attr('src') ?? document(element).attr('href'))
            .get(),
    );
    for (const script of scriptPreloads) {
        if (!scriptAssetName.test(script)) continue;
        const href = `/assets/${script}`;
        if (linkedResources.has(href)) continue;
        // Keep the two large presentation modules behind first-paint resources;
        // small static dependencies should not queue behind optional late downloads.
        const priority = /^(?:home-page|commerce-styles)-/u.test(script) ? 'low' : 'auto';
        document('head').append(
            `<link rel="modulepreload" crossorigin fetchpriority="${priority}" href="${href}">`,
        );
        linkedResources.add(href);
    }
    document('#root').attr('data-public-rendered', '1').html(body);
    // Match the client cascade before hydration: shared commerce presentation
    // precedes common overrides; page-specific resources follow them.
    const commerceStyles = document(
        'style[data-href="storefront-home-showcase"], style[data-href="storefront-service-entries"]',
    );
    const commonStyle = document('head link[rel="stylesheet"]').first();
    if (commerceStyles.length) {
        if (commonStyle.length) commonStyle.before(commerceStyles);
        else document('head').append(commerceStyles);
    }
    document('head').append(
        document('style[data-href="storefront-business-services"], style[data-href="storefront-support"]'),
    );
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
        let stage: PublicHtmlRenderStage = 'artifact-root';
        try {
            const { root, renderer } = measurePublicDocumentSync('render-artifact', () => {
                const artifactRoot = this.artifactRoot();
                stage = 'renderer-load';
                const rendererPath = realpathSync(resolve(artifactRoot, '.server/public-page-renderer.cjs'));
                if (this.lastRendererPath && this.lastRendererPath !== rendererPath)
                    delete loadRenderer.cache[this.lastRendererPath];
                const artifactRenderer = loadRenderer(rendererPath) as Renderer;
                this.lastRendererPath = rendererPath;
                return { root: artifactRoot, renderer: artifactRenderer };
            });
            stage = 'template-read';
            const template = await measurePublicDocument('render-template', () =>
                readFile(resolve(root, 'index.html'), 'utf8'),
            );
            stage = 'route-styles';
            const prefixes =
                page.request?.kind === 'product'
                    ? ['product-detail-page-']
                    : page.request?.kind === 'catalog'
                      ? [
                            'account-catalog-surfaces-',
                            ...(page.request.path === '/search' ? ['search-loading-', 'search-page-'] : []),
                        ]
                      : [];
            const preloadScripts =
                page.request?.kind === 'home' && typeof renderer.getPublicRouteScriptPreloads === 'function';
            const assets: string[] = await measurePublicDocument('render-styles', () =>
                prefixes.length || preloadScripts
                    ? readdir(resolve(root, 'assets')).catch(error => {
                          if (prefixes.length) throw error;
                          // An optional download hint must not make an otherwise valid HTML response fail.
                          return [];
                      })
                    : Promise.resolve([]),
            );
            const styles = prefixes.flatMap(prefix =>
                assets.filter(file => file.endsWith('.css') && file.startsWith(prefix)).sort(),
            );
            if (prefixes.some(prefix => !styles.some(file => file.startsWith(prefix))))
                throw new Error('Missing public route stylesheet');
            let scriptPreloads: string[] = [];
            if (preloadScripts) {
                try {
                    const hints = await measurePublicDocument('render-styles', async () =>
                        renderer.getPublicRouteScriptPreloads?.(page, assets, async file => {
                            if (!scriptAssetName.test(file) || !assets.includes(file))
                                throw new Error('Invalid public script asset');
                            return readFile(resolve(root, 'assets', file), 'utf8');
                        }),
                    );
                    if (hints?.every(file => scriptAssetName.test(file) && assets.includes(file)))
                        scriptPreloads = hints;
                } catch {
                    // Older or incompatible optional hint providers retain the existing rendering path.
                }
            }
            stage = 'body-render';
            const body = await measurePublicDocument('render-react', () => renderer.renderPublicPage(page));
            if (!body.trim()) throw new Error('Public renderer produced empty HTML');
            stage = 'html-assemble';
            return measurePublicDocumentSync('render-assemble', () =>
                assemblePublicHtml(template, page, body, styles, scriptPreloads),
            );
        } catch (error) {
            // A broken/missing render artifact is temporary, never an indexable empty 200 page.
            throw new PublicHtmlRenderError(stage, error);
        }
    }
}
