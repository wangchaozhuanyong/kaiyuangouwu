// @vitest-environment node
import { ServiceUnavailableException } from '@nestjs/common';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    fixtureKinds,
    fixtureLanguages,
    fixtureStores,
    syntheticPage,
} from '../../../storefront/e2e/seo-public/fixtures.mjs';
import { publicDocumentTimingHeader, withPublicDocumentTiming } from '../performance/public-document-timing';

import { assemblePublicHtml, StorefrontSeoHtmlService } from './storefront-seo-html.service';

describe('public HTML renderer failure diagnostics', () => {
    afterEach(() => vi.restoreAllMocks());

    it('retains the original filesystem failure and stage for the controller without exposing it in the response', async () => {
        const cause = Object.assign(new Error('private-filesystem-path'), { code: 'ENOENT' });
        const service = new StorefrontSeoHtmlService();
        vi.spyOn(service as unknown as { artifactRoot(): string }, 'artifactRoot').mockImplementation(() => {
            throw cause;
        });

        await withPublicDocumentTiming(async () => {
            await expect(service.render({} as never)).rejects.toMatchObject({
                status: 503,
                renderStage: 'artifact-root',
                cause,
            });
            const header = publicDocumentTimingHeader().join(', ');
            expect(header).toMatch(/^storefront-render-artifact;dur=\d+\.\d$/u);
            expect(header).not.toContain(cause.message);
        });
        await expect(service.render({} as never)).rejects.toMatchObject({
            response: {
                statusCode: 503,
                message: 'Public storefront rendering is temporarily unavailable',
            },
        });
    });
});

describe('public HTML optional route script hints', () => {
    const home = 'home-page-12345678.js';
    const wrapper = 'catalog-route-pages-12345678.js';
    const shell =
        '<html><head><script type="module" src="/assets/index-12345678.js"></script></head>' +
        '<body><div id="root"></div></body></html>';
    const payload = () => syntheticPage(fixtureStores[0], 'en', 'home');
    it('discovers CSS before inline commerce styles without changing cascade or fetch credentials', () => {
        const stylesheet = '<link rel="stylesheet" crossorigin="anonymous" href="/assets/common-123.css">';
        const html = assemblePublicHtml(
            shell.replace('</head>', stylesheet + '</head>'),
            payload(),
            '<style data-href="storefront-home-showcase">.hero {height: 200px}</style><main>Ready</main>',
        );
        const dom = load(html);
        const hint = dom('head link[rel="preload"][as="style"]');
        expect(hint).toHaveLength(1);
        expect(hint.attr('href')).toBe('/assets/common-123.css');
        expect(hint.attr('crossorigin')).toBe('anonymous');
        expect(html.indexOf('as="style"')).toBeLessThan(html.indexOf('data-href="storefront-home-showcase"'));
        expect(html.indexOf('data-href="storefront-home-showcase"')).toBeLessThan(
            html.indexOf('rel="stylesheet"'),
        );
        expect(dom('head link[rel="stylesheet"]')).toHaveLength(1);
        expect(dom('style[data-href="storefront-home-showcase"]')).toHaveLength(1);
    });
    const hints = (html: string) => {
        const dom = load(html);
        return dom('head link[rel="modulepreload"]')
            .map((_index, element) => dom(element).attr('href'))
            .get();
    };
    const artifactService = async (provider: string, assets?: string[]) => {
        const output = path.resolve(__dirname, '../../../../tmp/public-route-script-preloads');
        await mkdir(output, { recursive: true });
        const root = await mkdtemp(path.join(output, 'artifact-'));
        await mkdir(path.join(root, '.server'));
        await writeFile(path.join(root, 'index.html'), shell);
        await writeFile(
            path.join(root, '.server/public-page-renderer.cjs'),
            `exports.renderPublicPage = async () => '<main>Matching renderer body</main>';\n${provider}`,
        );
        if (assets) {
            await mkdir(path.join(root, 'assets'));
            await Promise.all(assets.map(file => writeFile(path.join(root, 'assets', file), 'export {};')));
        }
        const service = new StorefrontSeoHtmlService();
        vi.spyOn(service as unknown as { artifactRoot(): string }, 'artifactRoot').mockReturnValue(root);
        return service;
    };

    afterEach(() => vi.restoreAllMocks());

    it('uses the loaded renderer and its own asset directory without executing hinted scripts', async () => {
        const service = await artifactService(
            `exports.getPublicRouteScriptPreloads = async (page, assets, readSource) => {
                if (page.request.kind !== 'home' || !assets.includes('${home}')) throw new Error('Wrong inputs');
                if (await readSource('${home}') !== 'export {};') throw new Error('Wrong artifact source');
                return ['${home}', '${wrapper}', '${home}', 'vendor-12345678.js', 'index-12345678.js'];
            };`,
            [home, wrapper, 'vendor-12345678.js', 'index-12345678.js'],
        );
        const html = await withPublicDocumentTiming(async () => {
            const result = await service.render(payload());
            expect(publicDocumentTimingHeader().join(', ')).toMatch(/storefront-render-styles;dur=\d+\.\d/u);
            return result;
        });
        const dom = load(html);
        expect(hints(html)).toEqual([`/assets/${home}`, `/assets/${wrapper}`, '/assets/vendor-12345678.js']);
        expect(dom('head link[rel="modulepreload"][crossorigin][fetchpriority="low"]')).toHaveLength(1);
        expect(dom('head link[rel="modulepreload"][crossorigin][fetchpriority="auto"]')).toHaveLength(2);
        expect(dom('script[src]')).toHaveLength(1);
        expect(dom('#root').text()).toBe('Matching renderer body');
    });

    it('keeps older renderers compatible without requiring an asset directory', async () => {
        const service = await artifactService('');
        const html = await service.render(payload());
        expect(hints(html)).toEqual([]);
        expect(load(html)('#root').text()).toBe('Matching renderer body');
    });

    it('does not call the home hint provider for another public route', async () => {
        const service = await artifactService(
            "exports.getPublicRouteScriptPreloads = () => { throw new Error('Home only'); };",
        );
        const html = await service.render(syntheticPage(fixtureStores[0], 'en', 'article'));
        expect(hints(html)).toEqual([]);
        expect(load(html)('#root').text()).toBe('Matching renderer body');
    });

    it.each([
        ['missing assets', `exports.getPublicRouteScriptPreloads = () => ['${home}'];`],
        [
            'provider failure',
            "exports.getPublicRouteScriptPreloads = () => { throw new Error('Hint failure'); };",
        ],
    ])('does not fail a valid document on optional %s', async (_label, provider) => {
        const service = await artifactService(provider);
        const html = await service.render(payload());
        expect(hints(html)).toEqual([]);
        expect(load(html)('#root').text()).toBe('Matching renderer body');
    });

    it.each(['../outside.js', 'missing-12345678.js', `${home}?version=1`])(
        'does not allow the renderer source callback to read %s',
        async file => {
            const service = await artifactService(
                `exports.getPublicRouteScriptPreloads = async (_page, _assets, readSource) => {
                    await readSource('${file}');
                    return ['${home}'];
                };`,
                [home, wrapper],
            );
            const html = await service.render(payload());
            expect(hints(html)).toEqual([]);
            expect(load(html)('#root').text()).toBe('Matching renderer body');
        },
    );

    it('omits the entire group when a renderer returns a missing asset', async () => {
        const service = await artifactService(
            `exports.getPublicRouteScriptPreloads = () => ['${home}', 'missing-12345678.js'];`,
            [home, wrapper],
        );
        expect(hints(await service.render(payload()))).toEqual([]);
    });

    it('deduplicates existing scripts and links and rejects unsafe names', () => {
        const template = shell.replace(
            '</head>',
            `<script type="module" src="/assets/${home}"></script>` +
                `<link rel="modulepreload" crossorigin href="/assets/${wrapper}"></head>`,
        );
        const html = assemblePublicHtml(
            template,
            payload(),
            '<main>Body</main>',
            [],
            [home, wrapper, home, '../outside.js', 'home-page-1234"678.js'],
        );
        const dom = load(html);
        expect(hints(html)).toEqual([`/assets/${wrapper}`]);
        expect(dom(`script[src="/assets/${home}"]`)).toHaveLength(1);
        expect(dom('script[src]')).toHaveLength(2);
    });
});

// Explicit opt-in: consumes the current matching built artifact without rebuilding or opening a browser.
describe.runIf(process.env.SEO_HTML_ARTIFACT_SMOKE === '1')(
    'public HTML service with the actual storefront build',
    () => {
        const project = path.resolve(__dirname, '../../../..');
        const artifact = path.join(project, 'packages/storefront/dist');
        const scenarios: string[] = [];
        const service = new StorefrontSeoHtmlService();
        let output: string;
        let fingerprints: Record<string, string>;
        const fingerprint = async () =>
            Object.fromEntries(
                await Promise.all(
                    ['index.html', '.server/public-page-renderer.cjs'].map(async name => [
                        name,
                        createHash('sha256')
                            .update(await readFile(path.join(artifact, name)))
                            .digest('hex'),
                    ]),
                ),
            );
        const page = (
            store: string,
            language: 'zh_Hans' | 'en',
            kind: 'home' | 'product' | 'catalog' | 'article',
        ) => {
            const value = syntheticPage(store, language, kind);
            if (!value.seo) throw new Error('Expected resolved fixture SEO');
            return { ...value, seo: value.seo };
        };

        beforeAll(async () => {
            await mkdir(path.join(project, 'tmp/seo-geo-readiness'), { recursive: true });
            output = await mkdtemp(path.join(project, 'tmp/seo-geo-readiness/html-service-'));
            fingerprints = await fingerprint();
        });
        afterEach(() => {
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
        });
        afterAll(async () => {
            expect(await fingerprint()).toEqual(fingerprints);
            await writeFile(
                path.join(output, 'verification.json'),
                `${JSON.stringify(
                    {
                        checkedAt: new Date().toISOString(),
                        artifact,
                        fingerprints,
                        scenarios,
                        passed: scenarios.length === 19,
                        runtime: 'actual StorefrontSeoHtmlService + built CJS renderer + built Vite template',
                        syntheticOnly: true,
                        noBusinessDatabase: true,
                    },
                    null,
                    2,
                )}\n`,
            );
            process.stdout.write(`HTML service evidence: ${path.join(output, 'verification.json')}\n`);
        });

        for (const store of fixtureStores)
            for (const language of fixtureLanguages)
                for (const kind of fixtureKinds) {
                    it(`${store}/${language}/${kind} reads the matching template and renderer and returns scoped real components`, async () => {
                        expect(typeof window).toBe('undefined');
                        const fetch = vi.fn(() => {
                            throw new Error('Server artifact must not fetch');
                        });
                        vi.stubGlobal('fetch', fetch);
                        expect(typeof sessionStorage).toBe('undefined');
                        const payload = page(store, language, kind);
                        const html = await service.render(payload);
                        const dom = load(html);
                        expect(dom('#root').attr('data-public-rendered')).toBe('1');
                        expect(dom('#root #storefront-content').length).toBe(1);
                        // The document keeps startup feedback outside React until app-owned;
                        // existing SSR must retain compact, non-blocking feedback, not an overlay.
                        const startup = dom('body > #storefront-boot-loading');
                        expect(startup).toHaveLength(1);
                        expect(dom('#root #storefront-boot-loading')).toHaveLength(0);
                        expect(startup.attr('role')).toBe('status');
                        expect(startup.attr('aria-busy')).toBe('true');
                        expect(dom('#root').is('[hidden], [inert]')).toBe(false);
                        expect(dom('script[defer][src^="/storefront/document-loading.js"]')).toHaveLength(1);
                        expect(dom('html').attr('lang')).toBe(language === 'zh_Hans' ? 'zh-CN' : 'en');
                        expect(dom('title').length).toBe(1);
                        expect(dom('title').text()).toBe(payload.seo.title);
                        expect(dom('meta[name="robots"]').length).toBe(1);
                        expect(dom('meta[name="robots"]').attr('content')).toBe(payload.seo.robots);
                        expect(dom('link[rel="canonical"]').attr('href')).toBe(payload.seo.canonical);
                        expect(dom('link[rel="alternate"]').length).toBe(payload.seo.alternates.length);
                        expect(dom('script[type="module"][src^="/assets/"]').length).toBeGreaterThan(0);
                        expect(dom('link[rel="stylesheet"][href^="/assets/index-"]').length).toBe(1);
                        const stylesheet = dom('link[rel="stylesheet"][href^="/assets/index-"]').attr('href');
                        if (!stylesheet) throw new Error('Missing matching startup stylesheet');
                        const css = await readFile(path.join(artifact, stylesheet), 'utf8');
                        const compactStyle = css.match(
                            /html\s+#storefront-boot-loading\[data-presentation=["']?status["']?\]\{([^}]+)\}/u,
                        )?.[1];
                        expect(compactStyle).toContain('pointer-events:none');
                        expect(compactStyle).toContain('inset:0 0 auto');
                        if (kind === 'home') {
                            expect(dom('head style[data-href="storefront-home-showcase"]')).toHaveLength(1);
                            expect(dom('#root style[data-href="storefront-home-showcase"]')).toHaveLength(0);
                            const headResources = dom('head').children().toArray();
                            expect(
                                headResources.indexOf(
                                    dom('head style[data-href="storefront-home-showcase"]')[0],
                                ),
                            ).toBeLessThan(headResources.indexOf(dom('head link[rel="stylesheet"]')[0]));
                            const routeScripts = (await readdir(path.join(artifact, 'assets'))).filter(file =>
                                /^(?:catalog-route-pages|home-page)-[\w-]{8}\.js$/u.test(file),
                            );
                            expect(routeScripts).toHaveLength(2);
                            for (const file of routeScripts) {
                                expect(
                                    dom(
                                        `head link[rel="modulepreload"][crossorigin][href="/assets/${file}"]`,
                                    ),
                                ).toHaveLength(1);
                                expect(dom(`script[src="/assets/${file}"]`)).toHaveLength(0);
                            }
                            for (const prefix of ['commerce-styles-', 'vendor-react-'])
                                expect(
                                    dom(
                                        `head link[rel="modulepreload"][crossorigin][href^="/assets/${prefix}"]`,
                                    ),
                                ).toHaveLength(1);
                            expect(
                                dom(
                                    'head link[rel="modulepreload"][href^="/assets/query-persistence-"], ' +
                                        'head link[rel="modulepreload"][href^="/assets/Feedback-"]',
                                ),
                            ).toHaveLength(0);
                        }
                        expect(html).not.toContain('<!--# include');
                        for (const other of fixtureStores) {
                            if (other !== store) expect(dom('#root').text()).not.toContain(other);
                        }
                        const inert = dom('script#storefront-public-page-data');
                        expect(inert.length).toBe(1);
                        expect(inert.attr('type')).toBe('application/json');
                        expect(JSON.parse(inert.text()).scope).toEqual(payload.scope);
                        expect(JSON.parse(dom('script[type="application/ld+json"]').text())).toEqual(
                            payload.seo.structuredData[0],
                        );
                        if (kind === 'product') {
                            if (!payload.product) throw new Error('Expected fixture product');
                            expect(dom('#root').text()).toContain(payload.product.name);
                            expect(
                                dom('link[rel="stylesheet"][href^="/assets/product-detail-page-"]').length,
                            ).toBeGreaterThan(0);
                        } else if (kind === 'catalog') {
                            if (!payload.catalog) throw new Error('Expected fixture catalog');
                            expect(dom('#root').text()).toContain(payload.catalog.items[0].name);
                            expect(
                                dom('link[rel="stylesheet"][href^="/assets/account-catalog-surfaces-"]')
                                    .length,
                            ).toBeGreaterThan(0);
                            const links = dom('#root a')
                                .map((_index, element) => dom(element).attr('href'))
                                .get();
                            expect(links.some(href => href.includes('page=3'))).toBe(true);
                        } else if (kind === 'article')
                            expect(dom('#root').text()).toContain(payload.publicContent?.body);
                        else expect(dom('#root').text()).toContain(payload.config.description);
                        expect(fetch).not.toHaveBeenCalled();
                        expect(typeof sessionStorage).toBe('undefined');
                        await writeFile(path.join(output, `${store}-${language}-${kind}.html`), html);
                        scenarios.push(
                            `${store}/${language}/${kind}: scoped body, head, public DTO, built assets, zero network requests, no server session storage`,
                        );
                    });
                }

        it('adds the search route styles through the actual service path', async () => {
            const payload = page(fixtureStores[0], 'en', 'catalog');
            if (payload.request?.kind !== 'catalog') throw new Error('Expected catalog fixture');
            payload.request.path = '/search';
            payload.request.input.term = 'Synthetic product';
            const searchUrl = new URL(payload.route, `https://${payload.scope.host}`);
            searchUrl.pathname = searchUrl.pathname.replace('/category', '/search');
            searchUrl.searchParams.set('term', payload.request.input.term);
            payload.route = searchUrl.pathname + searchUrl.search;
            payload.requestKey = JSON.stringify(payload.request);
            payload.seo.requestKey = payload.requestKey;
            payload.seo.canonical = `https://${payload.scope.host}${payload.route}`;
            const html = await service.render(payload);
            const dom = load(html);
            expect(dom('link[rel="stylesheet"][href^="/assets/search-page-"]').length).toBeGreaterThan(0);
            expect(dom('link[rel="stylesheet"][href^="/assets/search-loading-"]')).toHaveLength(1);
            expect(html.indexOf('href="/assets/account-catalog-surfaces-')).toBeLessThan(
                html.indexOf('href="/assets/search-loading-'),
            );
            expect(html.indexOf('href="/assets/search-loading-')).toBeLessThan(
                html.indexOf('href="/assets/search-page-'),
            );
            if (!payload.catalog) throw new Error('Expected fixture catalog');
            expect(dom('#root').text()).toContain(payload.catalog.items[0].name);
            scenarios.push('search: actual matching route CSS and catalog body');
        });

        it('preserves literal merchant text without executable scripts or JSON termination', async () => {
            const payload = page(fixtureStores[0], 'en', 'home');
            const marker = '</script><script id="qa-injection">throw 1</script> & \u2028';
            payload.seo.title = marker;
            payload.seo.description = marker;
            payload.seo.shareTitle = marker;
            payload.seo.shareDescription = marker;
            payload.seo.structuredData[0].name = marker;
            payload.config.description = marker;
            const html = await service.render(payload);
            const dom = load(html);
            expect(dom('#qa-injection').length).toBe(0);
            expect(dom('title').text()).toBe(marker);
            expect(dom('meta[property="og:title"]').attr('content')).toBe(marker);
            expect(dom('meta[property="og:description"]').attr('content')).toBe(marker);
            expect(dom('#storefront-public-page-data').text()).toContain('\\u003c/script\\u003e');
            expect(JSON.parse(dom('#storefront-public-page-data').text()).config.description).toBe(marker);
            expect(JSON.parse(dom('script[type="application/ld+json"]').text()).name).toBe(marker);
            await writeFile(path.join(output, 'literal-merchant-text.html'), html);
            scenarios.push(
                'literal merchant text: DOM script prevention, head escaping and inert JSON roundtrip',
            );
        });

        it('returns 503 when the actual renderer file is missing', async () => {
            const missing = path.join(output, 'missing-renderer');
            await mkdir(missing);
            await copyFile(path.join(artifact, 'index.html'), path.join(missing, 'index.html'));
            const broken = new StorefrontSeoHtmlService();
            vi.spyOn(broken as unknown as { artifactRoot(): string }, 'artifactRoot').mockReturnValue(
                missing,
            );
            await expect(broken.render(page(fixtureStores[0], 'en', 'home'))).rejects.toMatchObject({
                status: 503,
            });
            await expect(broken.render(page(fixtureStores[0], 'en', 'home'))).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            scenarios.push('missing renderer: service fails closed with 503, no fallback empty HTML');
        });
    },
);
