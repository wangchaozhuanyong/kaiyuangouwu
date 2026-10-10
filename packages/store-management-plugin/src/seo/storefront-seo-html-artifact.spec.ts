// @vitest-environment node
import { ServiceUnavailableException } from '@nestjs/common';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    fixtureKinds,
    fixtureLanguages,
    fixtureStores,
    syntheticPage,
} from '../../../storefront/e2e/seo-public/fixtures.mjs';

import { StorefrontSeoHtmlService } from './storefront-seo-html.service';

// Explicit opt-in: consumes the current matching built artifact without rebuilding or opening a browser.
describe.runIf(process.env.SEO_HTML_ARTIFACT_SMOKE === '1')(
    'public HTML service with the actual storefront build',
    () => {
        const project = path.resolve(process.cwd(), '../..');
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
                        expect(dom('#storefront-boot-loading').length).toBe(0);
                        expect(dom('html').attr('lang')).toBe(language === 'zh_Hans' ? 'zh-CN' : 'en');
                        expect(dom('title').length).toBe(1);
                        expect(dom('title').text()).toBe(payload.seo.title);
                        expect(dom('meta[name="robots"]').length).toBe(1);
                        expect(dom('meta[name="robots"]').attr('content')).toBe(payload.seo.robots);
                        expect(dom('link[rel="canonical"]').attr('href')).toBe(payload.seo.canonical);
                        expect(dom('link[rel="alternate"]').length).toBe(payload.seo.alternates.length);
                        expect(dom('script[type="module"][src^="/assets/"]').length).toBeGreaterThan(0);
                        expect(dom('link[rel="stylesheet"][href^="/assets/index-"]').length).toBe(1);
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
            payload.route = payload.route.replace('/category?', '/search?');
            payload.requestKey = JSON.stringify(payload.request);
            payload.seo.requestKey = payload.requestKey;
            payload.seo.canonical = `https://${payload.scope.host}${payload.route}`;
            const html = await service.render(payload);
            const dom = load(html);
            expect(dom('link[rel="stylesheet"][href^="/assets/search-page-"]').length).toBeGreaterThan(0);
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
