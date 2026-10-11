import { renderPublicSeoHead } from '@vendure/storefront-content-plugin';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';

import { assemblePublicHtml } from './storefront-seo-html.service';
import {
    buildPublicSeoDocument,
    publicRobots,
    sitemapXml,
    type PublicSeoFacts,
} from './storefront-seo-output';
import { defaultStorefrontSeoSettings, publicStorefrontSeoSettings } from './storefront-seo.contract';

const settings = () => ({
    ...publicStorefrontSeoSettings(defaultStorefrontSeoSettings()),
    indexingEnabled: true,
});
const facts = (host = 'store-a.test'): PublicSeoFacts => ({
    host,
    primaryHost: host,
    channelCode: host === 'store-a.test' ? 'store-a' : 'store-b',
    languageCode: 'en',
    mode: 'LIVE',
    title: 'Synthetic product',
    storeName: 'Synthetic test shop',
    description: 'Synthetic public description',
    image: null,
    completeLanguages: ['en', 'zh_Hans'],
    structuredData: [],
});

describe('one public SEO policy', () => {
    it('places the server-rendered home resource before common desktop CSS without duplicating it', () => {
        const seo = buildPublicSeoDocument({ kind: 'home' }, facts(), settings(), null, 1);
        const html = assemblePublicHtml(
            '<html><head><link rel="stylesheet" href="/assets/index-test.css">' +
                '<script type="module" src="/assets/test.js"></script></head><body><div id="root"></div></body></html>',
            { scope: {}, config: {}, seo } as never,
            '<style data-href="storefront-home-showcase" data-precedence="commerce">.product-grid{display:grid}</style><main>Home</main>',
        );
        const dom = load(html);
        expect(dom('head style[data-href="storefront-home-showcase"]')).toHaveLength(1);
        expect(dom('#root style')).toHaveLength(0);
        expect(html.indexOf('data-href="storefront-home-showcase"')).toBeLessThan(
            html.indexOf('href="/assets/index-test.css"'),
        );
        expect(dom('#root main').text()).toBe('Home');
        expect(dom('script[type="module"]')).toHaveLength(1);
    });
    it.each(['store-a.test', 'store-b.test'])('preserves product identity and locale on %s', host => {
        const page = buildPublicSeoDocument({ kind: 'product', id: '123' }, facts(host), settings(), null, 4);
        expect(page.indexable).toBe(true);
        expect(page.canonical).toBe(`https://${host}/en/product?id=123`);
        expect(page.alternates).toEqual([
            { language: 'en', href: `https://${host}/en/product?id=123` },
            { language: 'zh-CN', href: `https://${host}/zh/product?id=123` },
        ]);
        expect(page.version).toBe(4);
    });
    it.each(['PREVIEW', 'CLOSED'])('never overrides %s with an explicit INDEX document', mode => {
        const page = buildPublicSeoDocument(
            { kind: 'home' },
            { ...facts(), mode },
            settings(),
            {
                title: 'Override',
                description: '',
                shareTitle: '',
                shareDescription: '',
                shareImageUrl: '',
                indexMode: 'INDEX',
                article: null,
            },
            1,
        );
        expect(page.indexable).toBe(false);
        expect(page.reasons).toContain('STORE_NOT_LIVE');
        expect(page.alternates).toEqual([]);
    });
    it('keeps unpublished, unverified and incomplete languages out of indexing', () => {
        const page = buildPublicSeoDocument(
            { kind: 'home' },
            { ...facts(), primaryHost: null, completeLanguages: ['zh_Hans'] },
            null,
            null,
            0,
        );
        expect(page.indexable).toBe(false);
        expect(page.reasons).toEqual(
            expect.arrayContaining([
                'SEO_NOT_PUBLISHED',
                'PRIMARY_DOMAIN_NOT_VERIFIED',
                'LANGUAGE_CONTENT_INCOMPLETE',
            ]),
        );
    });
    it('retains the pagination identity and marks arbitrary search/filter combinations noindex', () => {
        const base = { kind: 'catalog' as const, input: { collectionId: '456', skip: 12, take: 12 } };
        const page = buildPublicSeoDocument(base, facts(), settings(), null, 1);
        expect(page.canonical).toBe('https://store-a.test/en/category?collectionId=456&page=2');
        expect(page.indexable).toBe(true);
        for (const filter of [{ term: 'query' }, { inStockOnly: true }, { sort: 'PRICE_ASC' as const }]) {
            const filtered = buildPublicSeoDocument(
                { ...base, input: { ...base.input, ...filter } },
                facts(),
                settings(),
                null,
                1,
            );
            expect(filtered.indexable).toBe(false);
            expect(filtered.reasons).toContain('SEARCH_OR_FILTER');
        }
    });
    it('allows crawlers to retrieve noindex while separately blocking training bots', () => {
        const robots = publicRobots(
            publicStorefrontSeoSettings(defaultStorefrontSeoSettings()),
            'store-a.test',
            true,
        );
        expect(robots).toContain('User-agent: Googlebot\nAllow: /');
        expect(robots).toContain('User-agent: OAI-SearchBot\nAllow: /');
        expect(robots).toContain('User-agent: GPTBot\nDisallow: /');
        expect(robots).toContain('User-agent: Google-Extended\nDisallow: /');
        expect(robots).not.toContain('Disallow: /account');
        for (const name of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot']) {
            const group = robots.split(/\n\n+/u).find(block => block.startsWith(`User-agent: ${name}\n`));
            expect(group).toContain('Disallow: /shop-api');
            expect(group).toContain('Disallow: /admin-api');
            expect(group).toContain('Disallow: /_storefront/');
            expect(group).toContain('Disallow: /promo/account-entry');
        }
    });
    it.each([{ skip: 1, take: 2 }, { skip: 12, take: 24 }, { skip: 1 }])(
        'marks nonstandard API pagination noindex: %j',
        input => {
            const page = buildPublicSeoDocument({ kind: 'catalog', input }, facts(), settings(), null, 1);
            expect(page.indexable).toBe(false);
            expect(page.reasons).toContain('NONSTANDARD_PAGINATION');
            expect(page.alternates).toEqual([]);
        },
    );
    it('renders independent published sharing overrides and records the document version', () => {
        const document = {
            title: 'Search title',
            description: 'Search description',
            shareTitle: 'Shared title',
            shareDescription: 'Shared description',
            shareImageUrl: '',
            indexMode: 'INHERIT' as const,
            article: null,
        };
        const page = buildPublicSeoDocument({ kind: 'home' }, facts(), settings(), document, 4, 7);
        const head = load(renderPublicSeoHead(page));
        expect(head('title').text()).toBe('Search title');
        expect(head('meta[name="description"]').attr('content')).toBe('Search description');
        expect(head('meta[property="og:title"]').attr('content')).toBe('Shared title');
        expect(head('meta[name="twitter:description"]').attr('content')).toBe('Shared description');
        expect(page).toMatchObject({ version: 4, documentVersion: 7 });
    });
    it('escapes XML and never generates invented lastmod dates', () => {
        const xml = sitemapXml([{ url: 'https://store-a.test/en/category?collectionId=1&page=2' }]);
        expect(xml).toContain('collectionId=1&amp;page=2');
        expect(xml).not.toContain('<lastmod>');
        expect(() =>
            sitemapXml(Array.from({ length: 50_001 }, () => ({ url: 'https://store-a.test/en/' }))),
        ).toThrow('50000');
    });
    it('replaces original noindex and old canonical, safely serializes data and preserves artifact scripts', () => {
        const seo = buildPublicSeoDocument({ kind: 'home' }, facts(), settings(), null, 1);
        seo.title = 'Synthetic </title><script>alert(1)</script>';
        seo.shareTitle = seo.title;
        seo.structuredData = [{ '@type': 'Organization', name: '</script><script>alert(1)</script>' }];
        const page = {
            schemaVersion: 1,
            version: 'synthetic',
            generatedAt: 0,
            scope: {
                host: 'store-a.test',
                channelCode: 'store-a',
                languageCode: 'en',
                currencyCode: 'MYR',
                priceContext: 'public',
            },
            route: '/',
            config: {},
            media: [],
            failures: [],
            seo,
        };
        const html = assemblePublicHtml(
            '<!doctype html><html lang="zh-CN"><head><title>Old</title><meta name="robots" content="noindex">' +
                '<link rel="canonical" href="https://other.test"><script type="module" src="/assets/actual.js"></script></head>' +
                '<body><div id="root"><div>loader</div></div></body></html>',
            page as never,
            '<main>Synthetic visible body</main>',
        );
        expect(html).toContain('lang="en"');
        expect(html).toContain('data-public-rendered="1"');
        expect(html).toContain('/assets/actual.js');
        expect(html).not.toContain('https://other.test');
        expect(html).not.toContain('content="noindex"');
        const document = load(html);
        const executableScripts = document('script').filter(
            (_index, element) =>
                !['application/json', 'application/ld+json'].includes(document(element).attr('type') ?? ''),
        );
        expect(executableScripts).toHaveLength(1);
        expect(executableScripts.attr('src')).toBe('/assets/actual.js');
        expect(executableScripts.text()).toBe('');
        expect(document('title').text()).toBe(seo.title);
        expect(document('meta[property="og:title"]').attr('content')).toBe(seo.title);
        expect(html).toContain('\\u003c/script\\u003e');
        expect(html).toContain('Synthetic visible body');
    });
});
