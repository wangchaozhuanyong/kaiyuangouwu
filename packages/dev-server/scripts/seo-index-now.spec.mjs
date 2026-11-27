import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    MAX_BATCH,
    buildIndexNowBody,
    chunk,
    parseSitemapIndex,
    parseUrlSet,
    selectSubmissionUrls,
} from './seo-index-now.mjs';

const HOST = 'https://store.example';

describe('sitemap reading', () => {
    it('reads child sitemap locations from an index', () => {
        const xml = `<?xml version="1.0"?><sitemapindex>
            <sitemap><loc>https://store.example/sitemap-pages.xml</loc></sitemap>
            <sitemap><loc>https://store.example/sitemap-products-0.xml</loc></sitemap>
        </sitemapindex>`;
        assert.deepEqual(parseSitemapIndex(xml), [
            'https://store.example/sitemap-pages.xml',
            'https://store.example/sitemap-products-0.xml',
        ]);
    });

    it('reads page locations from a urlset and ignores lastmod', () => {
        const xml = `<urlset>
            <url><loc>https://store.example/zh/</loc><lastmod>2026-11-23</lastmod></url>
            <url><loc>https://store.example/en/</loc></url>
        </urlset>`;
        assert.deepEqual(parseUrlSet(xml), ['https://store.example/zh/', 'https://store.example/en/']);
    });

    it('returns nothing for unrelated markup', () => {
        assert.deepEqual(parseSitemapIndex('<html></html>'), []);
        assert.deepEqual(parseUrlSet(''), []);
    });
});

describe('submission selection', () => {
    it('keeps same-origin https pages and drops the rest', () => {
        const urls = [
            'https://store.example/zh/',
            'http://store.example/en/',
            'https://other.example/zh/',
            'not a url',
            'https://store.example/zh/',
        ];
        assert.deepEqual(selectSubmissionUrls({ urls, host: HOST }), ['https://store.example/zh/']);
    });

    it('never submits private API or promotion entry points', () => {
        const urls = [
            'https://store.example/shop-api',
            'https://store.example/admin-api',
            'https://store.example/_storefront/data',
            'https://store.example/promo/enter',
            'https://store.example/zh/product?id=1',
        ];
        assert.deepEqual(selectSubmissionUrls({ urls, host: HOST }), [
            'https://store.example/zh/product?id=1',
        ]);
    });

    it('applies the include pattern and the limit after de-duplication', () => {
        const urls = [
            'https://store.example/zh/p/codex-go-1month',
            'https://store.example/en/p/codex-go-1month',
            'https://store.example/zh/c/codex-subscription',
        ];
        assert.deepEqual(selectSubmissionUrls({ urls, host: HOST, include: '/p/' }), [
            'https://store.example/zh/p/codex-go-1month',
            'https://store.example/en/p/codex-go-1month',
        ]);
        assert.equal(selectSubmissionUrls({ urls, host: HOST, limit: 2 }).length, 2);
    });
});

describe('batches and payload', () => {
    it('splits at the IndexNow limit without losing URLs', () => {
        const urls = Array.from({ length: MAX_BATCH + 2 }, (_, index) => `https://store.example/p/${index}`);
        const batches = chunk(urls);
        assert.equal(batches.length, 2);
        assert.equal(batches[0].length, MAX_BATCH);
        assert.equal(batches[1].length, 2);
        assert.equal(batches.flat().length, urls.length);
    });

    it('uses the host name and the default key location', () => {
        assert.deepEqual(
            buildIndexNowBody({ host: HOST, key: 'abc12345', urlList: ['https://store.example/'] }),
            {
                host: 'store.example',
                key: 'abc12345',
                keyLocation: 'https://store.example/abc12345.txt',
                urlList: ['https://store.example/'],
            },
        );
    });
});
