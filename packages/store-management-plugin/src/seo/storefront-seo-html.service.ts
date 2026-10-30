import { Injectable, Optional } from '@nestjs/common';
import { RequestContext } from '@vendure/core';
import {
    isReusablePublicPageData,
    isStorefrontVisualPresetId,
    renderPublicSeoHead,
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    serializeStorefrontPageData,
    storefrontSkinCssVariables,
    type StorefrontPageData,
} from '@vendure/storefront-content-plugin';
import { load } from 'cheerio';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import {
    measurePublicDocument,
    measurePublicDocumentSync,
    recordPublicHtmlCache,
} from '../performance/public-document-timing';
import { StorefrontPublicCacheService } from '../performance/storefront-public-cache.service';
import { renderStorefrontIconLinks } from '../storefront-lcp-preload.service';

import { PublicHtmlRenderError, type PublicHtmlRenderStage } from './public-render-diagnostics';

type Renderer = {
    renderPublicPage(page: StorefrontPageData): Promise<string>;
    publicRouteScriptPreloadScope?: 'home-static-v1';
    getPublicRouteScriptPreloads?(
        page: StorefrontPageData,
        assetNames: readonly string[],
        readSource: (file: string) => Promise<string>,
    ): string[] | Promise<string[]>;
};
const loadRenderer = createRequire(__filename);
const scriptAssetName = /^[\w-]+\.js$/u;
const publicBodyParserOptions = {
    xml: {
        xmlMode: false,
        decodeEntities: true,
        lowerCaseAttributeNames: false,
        lowerCaseTags: false,
        // dom-serializer consumes this alongside Cheerio's parser options.
        // Preserve UTF-8 text instead of expanding Chinese into numeric entities.
        encodeEntities: 'utf8' as const,
    },
};
const SNAPSHOT_LIFETIME = 30_000;
const MAX_HTML_ENTRIES = 64;
const MAX_HTML_BYTES = 32 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const ACTIVE_STOREFRONT_ROOT = '/var/www/kaiyuangouwu-storefront-current';
type ArtifactInputs = {
    root: string;
    template?: Promise<PreparedPublicHtmlTemplate>;
    assets?: Promise<string[]>;
    scriptPreloads?: Promise<string[] | undefined>;
};

export interface PreparedPublicHtmlTemplate {
    readonly shell: string;
    readonly slots: Readonly<Record<'body' | 'state' | 'commerce' | 'trailing', string>>;
}

/** Only immutable artifact structure is reusable. No merchant data is retained here. */
export function preparePublicHtmlTemplate(template: string): PreparedPublicHtmlTemplate {
    const document = load(template.replace(/<!--#\s*include[\s\S]*?-->/gu, ''));
    if (document('#root').length !== 1 || !document('script[type="module"][src]').length)
        throw new Error('Invalid storefront artifact shell');
    document(
        [
            'title',
            'meta[name="description"]',
            'meta[name="robots"]',
            'link[rel="canonical"]',
            'link[rel="alternate"]',
            'link[rel~="icon"]',
            'link[rel="apple-touch-icon"]',
            '#storefront-public-page-data',
        ].join(', '),
    ).remove();
    document('meta[name], meta[property]').each((_index, element) => {
        const name = document(element).attr('name') ?? document(element).attr('property') ?? '';
        if (/^(?:og:|twitter:)/iu.test(name)) document(element).remove();
    });
    const prefix = `storefront-slot-${randomUUID()}`;
    const slots = Object.freeze({
        body: `<!--${prefix}-body-->`,
        state: `<!--${prefix}-state-->`,
        commerce: `<!--${prefix}-commerce-->`,
        trailing: `<!--${prefix}-trailing-->`,
    });
    document('#root').attr('data-public-rendered', '1').html(slots.body);
    document('body').append(slots.state);
    return Object.freeze({ shell: document.html(), slots });
}

/** Replace each private shell slot once; inserted HTML/data is never interpreted as a slot. */
function fillPublicHtmlSlots(shell: string, values: ReadonlyArray<readonly [string, string]>): string {
    const positions = values
        .map(([slot, value]) => {
            const index = shell.indexOf(slot);
            if (index < 0 || shell.indexOf(slot, index + slot.length) !== -1)
                throw new Error('Invalid public HTML insertion slot');
            return { index, slot, value };
        })
        .sort((a, b) => a.index - b.index);
    const output: string[] = [];
    let offset = 0;
    for (const { index, slot, value } of positions) {
        output.push(shell.slice(offset, index), value);
        offset = index + slot.length;
    }
    output.push(shell.slice(offset));
    return output.join('');
}

/** Replaces metadata without disturbing the matching artifact's styles, icons or script entry. */
export function assemblePublicHtml(
    template: string | PreparedPublicHtmlTemplate,
    page: StorefrontPageData,
    body: string,
    styles: string[] = [],
    scriptPreloads: string[] = [],
): string {
    const seo = page.seo;
    if (!seo) throw new Error('Missing public SEO resolution');
    const prepared =
        typeof template === 'string'
            ? measurePublicDocumentSync('render-template-prepare', () => preparePublicHtmlTemplate(template))
            : template;
    const document = measurePublicDocumentSync('render-shell-parse', () => load(prepared.shell));
    document('html').attr('lang', seo.languageCode === 'zh_Hans' ? 'zh-CN' : 'en');
    document('head').append(renderPublicSeoHead(seo));
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
    // React already emits a valid fragment. Cheerio's supported HTML-mode
    // htmlparser2 path avoids rebuilding a document/HTML5 insertion context;
    // preserve SVG attribute/tag casing and leave shell validation on parse5.
    const fragment = measurePublicDocumentSync('render-body-parse', () =>
        load(body, publicBodyParserOptions, false),
    );
    // Match the client cascade before hydration: shared commerce presentation
    // precedes common overrides; page-specific resources follow them.
    const moved = measurePublicDocumentSync('render-style-placement', () => {
        const commerce: string[] = [];
        const trailing: string[] = [];
        fragment('style[data-href]').each((_index, element) => {
            const name = fragment(element).attr('data-href');
            const target =
                name === 'storefront-home-showcase' || name === 'storefront-service-entries'
                    ? commerce
                    : name === 'storefront-business-services' || name === 'storefront-support'
                      ? trailing
                      : undefined;
            if (target) {
                target.push(fragment.html(element));
                fragment(element).remove();
            }
        });
        return { commerce: commerce.join(''), trailing: trailing.join('') };
    });
    const commonStyle = document('head link[rel="stylesheet"]').first();
    if (commonStyle.length) commonStyle.before(prepared.slots.commerce);
    else document('head').append(prepared.slots.commerce);
    // Discover render-blocking CSS before the large inline commerce resource,
    // without moving its stylesheet and changing the server/client cascade.
    const styleHints: string[] = [];
    const hintedStyles = new Set(
        document('head link[rel="preload"][as="style"]')
            .map((_index, element) => document(element).attr('href'))
            .get(),
    );
    document('head link[rel="stylesheet"]').each((_index, element) => {
        const stylesheet = document(element);
        const href = stylesheet.attr('href');
        if (!href || !/^\/assets\/[\w-]+\.css$/u.test(href) || hintedStyles.has(href)) return;
        const hint = document('<link rel="preload" as="style">').attr('href', href);
        for (const attribute of ['crossorigin', 'integrity', 'referrerpolicy', 'media']) {
            const value = stylesheet.attr(attribute);
            if (value !== undefined) hint.attr(attribute, value);
        }
        styleHints.push(document.html(hint));
        hintedStyles.add(href);
    });
    document('head').prepend(styleHints.join(''));
    document('head').append(prepared.slots.trailing);
    const state = measurePublicDocumentSync(
        'render-snapshot-serialize',
        () =>
            `<script type="application/json" id="storefront-public-page-data">${serializeStorefrontPageData(page)}</script>`,
    );
    return measurePublicDocumentSync('render-output', () =>
        fillPublicHtmlSlots(document.html(), [
            [prepared.slots.body, fragment.html()],
            [prepared.slots.state, state],
            [prepared.slots.commerce, moved.commerce],
            [prepared.slots.trailing, moved.trailing],
        ]),
    );
}

@Injectable()
export class StorefrontSeoHtmlService {
    private lastRendererPath?: string;
    private artifactInputs?: ArtifactInputs;
    // Admission bookkeeping only. HTML and in-flight work stay in the existing public cache.
    private readonly admissions = new Map<symbol, { bytes: number; expiresAt: number }>();

    constructor(@Optional() private readonly publicCache?: StorefrontPublicCacheService) {}

    private immutableRoot(root: string): boolean {
        return existsSync(ACTIVE_STOREFRONT_ROOT) && realpathSync(ACTIVE_STOREFRONT_ROOT) === root;
    }

    private inputs(root: string): ArtifactInputs | undefined {
        // Local dist can be rebuilt in place. Production roots identify immutable releases.
        if (!this.immutableRoot(root)) return undefined;
        if (this.artifactInputs?.root !== root) this.artifactInputs = { root };
        return this.artifactInputs;
    }

    private assets(root: string, inputs?: ArtifactInputs): Promise<string[]> {
        if (!inputs) return readdir(resolve(root, 'assets'));
        if (!inputs.assets) {
            inputs.assets = readdir(resolve(root, 'assets')).then(
                names => {
                    if (names.length > 4096) inputs.assets = undefined;
                    return names;
                },
                error => {
                    inputs.assets = undefined;
                    throw error;
                },
            );
        }
        return inputs.assets;
    }

    private template(root: string, inputs?: ArtifactInputs): Promise<PreparedPublicHtmlTemplate> {
        const read = async () => {
            const source = await readFile(resolve(root, 'index.html'), 'utf8');
            return measurePublicDocumentSync('render-template-prepare', () =>
                preparePublicHtmlTemplate(source),
            );
        };
        if (!inputs) return read();
        if (!inputs.template) {
            inputs.template = read().catch(error => {
                inputs.template = undefined;
                throw error;
            });
        }
        return inputs.template;
    }

    private admit(html: string, expiresAt: number): boolean {
        const now = Date.now();
        for (const [id, entry] of this.admissions) if (entry.expiresAt <= now) this.admissions.delete(id);
        // Capacity is measured in retained UTF-8 bytes. Reserving three bytes for
        // every code unit overcounts mostly-ASCII HTML/JSON across warm generations
        // and can reject documents while most of the existing budget is unused.
        const bytes = Buffer.byteLength(html, 'utf8');
        const used = [...this.admissions.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        if (
            expiresAt <= now ||
            bytes > MAX_DOCUMENT_BYTES ||
            this.admissions.size >= MAX_HTML_ENTRIES ||
            used + bytes > MAX_HTML_BYTES
        )
            return false;
        // Reserve beyond the public cache's maximum entry lifetime, including a
        // fill which finishes near source expiry. Early eviction only makes this conservative.
        // A changed public revision can retain another entry for the same content hash.
        // Count every attempted fill independently, including conservative CAS losers.
        this.admissions.set(Symbol(), { bytes, expiresAt: now + 60_000 });
        return true;
    }

    private artifactRoot(): string {
        // Operational deployment pointer, never a merchant presentation choice.
        const local = resolve(__dirname, '../../../storefront/dist');
        return existsSync(ACTIVE_STOREFRONT_ROOT) ? realpathSync(ACTIVE_STOREFRONT_ROOT) : local;
    }

    async render(page: StorefrontPageData, ctx?: RequestContext): Promise<string> {
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
            const generate = async () => {
                const inputs = this.inputs(root);
                stage = 'template-read';
                const template = await measurePublicDocument('render-template', () =>
                    this.template(root, inputs),
                );
                stage = 'route-styles';
                const prefixes =
                    page.request?.kind === 'product'
                        ? ['product-detail-page-']
                        : page.request?.kind === 'catalog'
                          ? [
                                'account-catalog-surfaces-',
                                ...(page.request.path === '/search'
                                    ? ['search-loading-', 'search-page-']
                                    : []),
                            ]
                          : [];
                const preloadScripts =
                    page.request?.kind === 'home' &&
                    typeof renderer.getPublicRouteScriptPreloads === 'function';
                const assets: string[] = await measurePublicDocument('render-styles', () =>
                    prefixes.length || preloadScripts
                        ? this.assets(root, inputs).catch(error => {
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
                        const readHints = async () =>
                            renderer.getPublicRouteScriptPreloads?.(page, assets, async file => {
                                if (!scriptAssetName.test(file) || !assets.includes(file))
                                    throw new Error('Invalid public script asset');
                                return readFile(resolve(root, 'assets', file), 'utf8');
                            });
                        const hints = await measurePublicDocument('render-styles', async () => {
                            // Only an explicit renderer contract permits reuse across public data.
                            if (!inputs || renderer.publicRouteScriptPreloadScope !== 'home-static-v1')
                                return readHints();
                            if (!inputs.scriptPreloads)
                                inputs.scriptPreloads = readHints().then(
                                    names => {
                                        if (
                                            !names?.length ||
                                            names.length > 96 ||
                                            !names.every(
                                                file => scriptAssetName.test(file) && assets.includes(file),
                                            )
                                        )
                                            inputs.scriptPreloads = undefined;
                                        return names;
                                    },
                                    error => {
                                        inputs.scriptPreloads = undefined;
                                        throw error;
                                    },
                                );
                            return inputs.scriptPreloads;
                        });
                        if (hints?.every(file => scriptAssetName.test(file) && assets.includes(file)))
                            scriptPreloads = hints;
                    } catch {
                        // Older or incompatible optional hint providers retain the existing rendering path.
                    }
                }
                stage = 'body-render';
                const body = await measurePublicDocument('render-react', () =>
                    renderer.renderPublicPage(page),
                );
                if (!body.trim()) throw new Error('Public renderer produced empty HTML');
                stage = 'html-assemble';
                return measurePublicDocumentSync('render-assemble', () =>
                    assemblePublicHtml(template, page, body, styles, scriptPreloads),
                );
            };
            const expiresAt = page.generatedAt + SNAPSHOT_LIFETIME;
            const ttl = Math.min(SNAPSHOT_LIFETIME, expiresAt - Date.now());
            if (
                !this.publicCache ||
                !ctx ||
                ctx.apiType !== 'shop' ||
                ctx.activeUserId ||
                ctx.session ||
                !isReusablePublicPageData(page) ||
                (page.config as { accessMode?: string }).accessMode !== 'LIVE' ||
                page.scope.priceContext !== 'public' ||
                page.scope.channelCode !== ctx.channel.code ||
                page.scope.languageCode !== String(ctx.languageCode) ||
                page.scope.currencyCode !== String(ctx.currencyCode) ||
                page.failures.length ||
                !Number.isFinite(ttl) ||
                ttl <= 0
            ) {
                recordPublicHtmlCache('bypass');
                return await generate();
            }
            stage = 'html-cache';
            // Include every rendered input, including media, SEO and coupon audience.
            // Resolve the actual renderer before a hit so a deployment switch changes its identity.
            const key = measurePublicDocumentSync('render-key', () =>
                createHash('sha256')
                    .update(
                        JSON.stringify([
                            String(ctx.channelId),
                            root,
                            Object.fromEntries(
                                Object.keys(page)
                                    .sort()
                                    .map(field => [field, page[field as keyof StorefrontPageData]]),
                            ),
                        ]),
                    )
                    .digest('hex'),
            );
            return await this.publicCache.readThrough(ctx, `rendered-html:v1:${key}`, ttl, generate, {
                shouldCache: html => this.admit(html, expiresAt),
                observeRead: recordPublicHtmlCache,
            });
        } catch (error) {
            // A broken/missing render artifact is temporary, never an indexable empty 200 page.
            throw new PublicHtmlRenderError(stage, error);
        }
    }
}
