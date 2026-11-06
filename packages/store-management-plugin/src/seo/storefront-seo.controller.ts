import {
    Controller,
    Get,
    NotFoundException,
    Req,
    Res,
    ServiceUnavailableException,
    UseFilters,
} from '@nestjs/common';
import { LanguageCode, Logger, RequestContextService } from '@vendure/core';
import { publicPageRequestFromUrl, publicPageRouteHref } from '@vendure/storefront-content-plugin';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { publicDocumentTimingHeader, withPublicDocumentTiming } from '../performance/public-document-timing';
import { StorefrontPromotionAccessService } from '../promotion/storefront-promotion-access.service';
import { StorefrontClosedHttpFilter } from '../storefront-closed-http.filter';
import { StorefrontPublicPageService } from '../storefront-public-page.service';
import { publicPagePreferences, trustedPublicPageHeaders } from '../storefront-public-request';

import { publicRenderFailureDetails, type PublicDocumentStage } from './public-render-diagnostics';
import { StorefrontPublicSeoService } from './storefront-public-seo.service';
import { StorefrontSeoHtmlService } from './storefront-seo-html.service';
import { StorefrontSeoService } from './storefront-seo.service';

const trackingKeys = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'gbraid',
    'wbraid',
];

function renderCatalogNotFound(code: 'zh_Hans' | 'en'): string {
    const chinese = code === 'zh_Hans';
    const path = chinese ? '/zh' : '/en';
    const title = chinese ? '页面未找到' : 'Page not found';
    const description = chinese
        ? '这个商品或分类可能已下架，或者链接已经失效。'
        : 'This product or category may have been removed, or its link may have changed.';
    const home = chinese ? '返回商城首页' : 'Back to store home';
    const catalog = chinese ? '浏览商品' : 'Browse products';
    return `<!doctype html>
<html lang="${chinese ? 'zh-CN' : 'en'}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, follow">
    <title>${title}</title>
    <style>
        :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
        body { margin: 0; padding: clamp(1rem, 6vw, 4rem); }
        main { max-inline-size: 36rem; margin: 12vh auto 0; }
        nav { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; }
        a { display: inline-flex; align-items: center; min-block-size: 44px; }
    </style>
</head>
<body>
    <main>
        <p aria-hidden="true">404</p>
        <h1>${title}</h1>
        <p>${description}</p>
        <nav aria-label="${chinese ? '商城导航' : 'Store navigation'}">
            <a href="${path}/">${home}</a>
            <a href="${path}/category">${catalog}</a>
        </nav>
    </main>
</body>
</html>`;
}

export function normalizedPublicRedirectPath(raw: string): string | null {
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 4096 || /[\\\r\n#]/u.test(raw))
        return null;
    const url = new URL(raw, 'https://storefront.invalid');
    if (url.origin !== 'https://storefront.invalid') return null;
    const seen = new Set<string>();
    for (const key of url.searchParams.keys()) {
        if (seen.has(key)) return null;
        seen.add(key);
    }
    for (const key of trackingKeys) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.pathname + url.search;
}

export function publicRedirectTracking(destination: string, original: string): string {
    const url = new URL(destination, 'https://storefront.invalid');
    const source = new URL(original, 'https://storefront.invalid');
    for (const key of trackingKeys) {
        const value = source.searchParams.get(key);
        if (value && value.length <= 250 && !/[\r\n]/u.test(value) && !url.searchParams.has(key))
            url.searchParams.set(key, value);
    }
    return url.origin === 'https://storefront.invalid' ? url.pathname + url.search : url.href;
}

@Controller('storefront')
@UseFilters(StorefrontClosedHttpFilter)
export class StorefrontSeoController {
    constructor(
        private readonly access: StorefrontPromotionAccessService,
        private readonly contexts: RequestContextService,
        private readonly pages: StorefrontPublicPageService,
        private readonly publicSeo: StorefrontPublicSeoService,
        private readonly html: StorefrontSeoHtmlService,
        private readonly seo: StorefrontSeoService,
    ) {}

    @Get('html')
    async document(@Req() req: Request, @Res() res: Response) {
        return withPublicDocumentTiming(() => this.renderDocument(req, res));
    }

    private async renderDocument(req: Request, res: Response) {
        const started = performance.now();
        const timings = new Map<string, number>();
        const measure = async <T>(name: string, read: () => Promise<T>): Promise<T> => {
            const start = performance.now();
            try {
                return await read();
            } finally {
                timings.set(name, performance.now() - start);
            }
        };
        const reportTiming = () => {
            timings.set('total', performance.now() - started);
            res.setHeader(
                'Server-Timing',
                [
                    ...[...timings].map(
                        ([name, duration]) => `storefront-${name};dur=${duration.toFixed(1)}`,
                    ),
                    ...publicDocumentTimingHeader(),
                ].join(', '),
            );
        };
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const verified = await measure('access', () => this.access.resolveRequest(req));
        if (!verified) {
            res.status(404).type('text/plain').send('Storefront not found');
            return;
        }
        const rawPath = trustedPublicPageHeaders(req)
            ? req.headers['x-storefront-original-uri']
            : req.query.path;
        if (typeof rawPath !== 'string') {
            res.status(400).end();
            return;
        }
        const configuration = await measure('settings', () => this.seo.publishedConfiguration(verified.ctx));
        const settings = configuration?.payload;
        const redirect = settings?.redirects.find(
            item => item.from === normalizedPublicRedirectPath(rawPath),
        );
        if (redirect) {
            res.redirect(redirect.status, publicRedirectTracking(redirect.to, rawPath));
            return;
        }
        let request: ReturnType<typeof publicPageRequestFromUrl>;
        try {
            request = publicPageRequestFromUrl(rawPath);
        } catch {
            res.status(400).end();
            return;
        }
        if (!request) {
            res.status(404).end();
            return;
        }
        const explicit = /^\/(zh|en)(?:\/|$)/u.exec(rawPath)?.[1];
        const defaultCode =
            verified.ctx.channel.defaultLanguageCode === LanguageCode.zh_Hans ? 'zh_Hans' : 'en';
        const code = explicit === 'zh' ? 'zh_Hans' : explicit === 'en' ? 'en' : defaultCode;
        const primary = await measure('domain', () => this.publicSeo.primaryHost(verified.ctx));
        if (!explicit || (primary && primary !== verified.host)) {
            const location = `${primary ? `https://${primary}` : ''}/${code === 'zh_Hans' ? 'zh' : 'en'}${publicPageRouteHref(request)}`;
            res.redirect(301, publicRedirectTracking(location, rawPath));
            return;
        }
        const preferences = publicPagePreferences(
            verified.ctx,
            code,
            verified.ctx.channel.defaultCurrencyCode,
        );
        const ctx = await measure('context', () =>
            this.contexts.create({
                apiType: 'shop',
                channelOrToken: verified.ctx.channel,
                ...preferences,
                req: {
                    headers: { host: verified.host },
                    protocol: 'https',
                    get: (name: string) => (name.toLowerCase() === 'host' ? verified.host : undefined),
                } as unknown as Request,
            }),
        );
        const startedAt = Date.now();
        let stage: PublicDocumentStage = 'read-page';
        try {
            // Both reads are request-local; the independent final authority check stays after rendering.
            const [documentPage, prepared] = await Promise.all([
                measure('page', () => this.pages.readForDocument(ctx, verified.host, request)),
                measure('prepare', async () => {
                    try {
                        return await this.publicSeo.prepare(ctx, verified.host, request, {
                            configuration,
                            primary,
                        });
                    } catch (error) {
                        stage = 'resolve-seo';
                        throw error;
                    }
                }),
            ]);
            stage = 'resolve-seo';
            const page = await measure('seo', () =>
                this.publicSeo.enrich(
                    ctx,
                    verified.host,
                    {
                        ...documentPage,
                        couponAudience:
                            trustedPublicPageHeaders(req) &&
                            req.headers['x-storefront-public-coupon-guest'] === '1'
                                ? 'anonymous'
                                : 'unknown',
                    },
                    prepared,
                ),
            );
            stage = 'required-content';
            if (page.failures.includes('content'))
                throw new ServiceUnavailableException('Public content is unavailable');
            stage = 'render-html';
            const rendered = await measure('render', () => this.html.render(page, ctx));
            stage = 'verify-publication';
            await measure('check', () => this.publicSeo.assertOutput(ctx, page));
            stage = 'resolved-seo';
            if (!page.seo) throw new ServiceUnavailableException('Public SEO resolution is unavailable');
            res.setHeader('X-Robots-Tag', page.seo.robots);
            reportTiming();
            res.status(200).type('html').send(rendered);
        } catch (error) {
            res.setHeader('X-Robots-Tag', 'noindex, follow');
            reportTiming();
            if (error instanceof NotFoundException) {
                if (request.kind === 'product' || request.kind === 'catalog') {
                    res.status(404).type('html').send(renderCatalogNotFound(code));
                } else {
                    res.status(404).type('text/plain').send('Public page not found');
                }
            } else if (error instanceof ServiceUnavailableException) {
                const requestId = randomUUID();
                const ray = trustedPublicPageHeaders(req) ? req.headers['cf-ray'] : undefined;
                res.setHeader('X-Request-Id', requestId);
                Logger.error(
                    JSON.stringify({
                        event: 'storefront.public-document.unavailable',
                        requestId,
                        cfRay:
                            typeof ray === 'string' && /^[a-fA-F0-9]{16}-[A-Za-z]{3}$/u.test(ray)
                                ? ray
                                : undefined,
                        channelId: String(ctx.channelId),
                        kind: request.kind,
                        language: code,
                        stage,
                        durationMs: Date.now() - startedAt,
                        ...publicRenderFailureDetails(error),
                    }),
                    'StorefrontPublicHtml',
                );
                res.status(503).type('text/plain').send('Public page temporarily unavailable');
            } else throw error;
        }
    }

    /** Resolve published redirects and explicitly enabled tool documents before Nginx falls back. */
    @Get('redirect')
    async legacyRedirect(@Req() req: Request, @Res() res: Response) {
        res.setHeader('Cache-Control', 'no-store');
        const verified = await this.access.resolveRequest(req);
        if (!verified) {
            res.status(404).end();
            return;
        }
        const trusted = trustedPublicPageHeaders(req);
        const raw = trusted ? req.headers['x-storefront-original-uri'] : req.query.path;
        const path = typeof raw === 'string' ? normalizedPublicRedirectPath(raw) : null;
        const settings = await this.seo.publishedSettings(verified.ctx);
        const redirect = path && settings?.redirects.find(item => item.from === path);
        if (redirect) {
            res.redirect(redirect.status, publicRedirectTracking(redirect.to, raw as string));
            return;
        }
        const tool = trusted && path && /^(?:\/(zh|en))?\/environment-monitor\/?(?:[?]|$)/u.exec(path);
        if (tool) {
            const language =
                tool[1] === 'zh'
                    ? LanguageCode.zh_Hans
                    : tool[1] === 'en'
                      ? LanguageCode.en
                      : verified.ctx.languageCode;
            if (
                await this.pages.isClientPluginPublished(verified.ctx, 'environment-monitor-entry', language)
            ) {
                // Serve the current shell at the requested URL using its existing noindex and security headers.
                res.setHeader('X-Accel-Redirect', '/index.html');
                res.status(200).end();
                return;
            }
        }
        res.status(404).end();
    }

    @Get('robots')
    async robots(@Req() req: Request, @Res() res: Response) {
        const verified = await this.access.resolveRequest(req);
        if (!verified) {
            res.status(404).end();
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.type('text/plain').send(await this.publicSeo.robots(verified.ctx));
    }

    @Get('sitemap')
    async sitemap(@Req() req: Request, @Res() res: Response) {
        const verified = await this.access.resolveRequest(req);
        if (!verified) {
            res.status(404).end();
            return;
        }
        const kind = req.query.kind ?? 'index';
        if (!['index', 'pages', 'products', 'collections'].includes(kind as string)) {
            res.status(404).end();
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/xml').send(
            await this.publicSeo.sitemap(
                verified.ctx,
                verified.host,
                kind as 'index' | 'pages' | 'products' | 'collections',
                Number(req.query.shard ?? 0),
            ),
        );
    }

    @Get('llms')
    async llms(@Req() req: Request, @Res() res: Response) {
        const verified = await this.access.resolveRequest(req);
        if (!verified) {
            res.status(404).end();
            return;
        }
        const configuration = await this.seo.publishedConfiguration(verified.ctx);
        const settings = configuration?.payload;
        const primary = await this.publicSeo.primaryHost(verified.ctx);
        if (
            !configuration ||
            !settings?.llmsEnabled ||
            !settings.indexingEnabled ||
            !primary ||
            (await this.pages.getAccessMode(verified.ctx)) !== 'LIVE'
        ) {
            res.status(404).end();
            return;
        }
        const content = (await this.seo.listPublished(verified.ctx, ['ARTICLE'])).filter(
            item =>
                item.payload.indexMode !== 'NOINDEX' &&
                settings.enabledLanguages.includes(item.languageCode as 'en' | 'zh_Hans'),
        );
        await this.publicSeo.assertDiscovery(verified.ctx, primary, configuration.version);
        res.setHeader('Cache-Control', 'no-store');
        res.type('text/plain').send(
            `# ${verified.ctx.channel.customFields?.storefrontNameEn || verified.ctx.channel.customFields?.storefrontNameZh || ''}\n\n` +
                content
                    .map(item => {
                        const title = item.payload.title.replace(/[\[\]\r\n]/gu, ' ');
                        const language = item.languageCode === 'zh_Hans' ? 'zh' : 'en';
                        const href = `https://${primary}/${language}/guides/${encodeURIComponent(item.targetId)}`;
                        return `- [${title}](${href})`;
                    })
                    .join('\n') +
                '\n',
        );
    }
}
