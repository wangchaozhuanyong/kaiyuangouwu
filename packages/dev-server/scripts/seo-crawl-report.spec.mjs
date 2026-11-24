import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateCrawlerLines, parseAccessLine, renderCrawlerMarkdown } from './seo-crawl-report.mjs';

const line = (overrides = {}) =>
    JSON.stringify({
        time: '2026-11-23T00:00:00+08:00',
        host: 'moyaoai.com',
        method: 'GET',
        path: '/zh/product',
        status: 200,
        request_time: 0.12,
        upstream_response_time: '0.10',
        crawler: 'googlebot',
        ...overrides,
    });

describe('access line parsing', () => {
    it('reads a crawler entry and defaults a missing class to "-"', () => {
        assert.deepEqual(parseAccessLine(line()), {
            crawler: 'googlebot',
            path: '/zh/product',
            status: 200,
            requestTime: 0.12,
            upstreamTime: 0.1,
            host: 'moyaoai.com',
        });
        assert.equal(parseAccessLine(line({ crawler: '' }))?.crawler, '-');
    });

    it('ignores non-JSON, truncated and status-less lines', () => {
        assert.equal(parseAccessLine('not json'), null);
        assert.equal(parseAccessLine('{"path":"/zh/"'), null);
        assert.equal(parseAccessLine(line({ status: 'abc' })), null);
    });
});

describe('crawler aggregation', () => {
    const entries = [
        parseAccessLine(line()),
        parseAccessLine(line({ path: '/zh/product', status: 404 })),
        parseAccessLine(line({ path: '/zh/', crawler: 'bingbot' })),
        parseAccessLine(line({ crawler: '-' })),
        parseAccessLine(line({ crawler: '-' })),
    ];

    it('counts only crawler requests and buckets statuses', () => {
        const report = aggregateCrawlerLines(entries, { top: 5 });
        assert.equal(report.total, 3);
        assert.deepEqual(report.crawlers, { googlebot: 2, bingbot: 1 });
        assert.deepEqual(report.statusByCrawler.googlebot, { '2xx': 1, '4xx': 1 });
        assert.deepEqual(report.paths[0], { path: '/zh/product', count: 2, errors: 1 });
    });

    it('filters by class and caps the ranked path list', () => {
        assert.equal(aggregateCrawlerLines(entries, { crawler: 'bingbot' }).total, 1);
        assert.equal(aggregateCrawlerLines(entries, { top: 1 }).paths.length, 1);
    });

    it('renders a report that names the crawlers and their errors', () => {
        const markdown = renderCrawlerMarkdown(aggregateCrawlerLines(entries), {
            generatedAt: '2026-11-23T00:00:00.000Z',
        });
        assert.match(markdown, /抓取请求总数：\*\*3\*\*/u);
        assert.match(markdown, /\| googlebot \| 2 \| 2xx: 1，4xx: 1 \|/u);
        assert.match(markdown, /\| \/zh\/product \| 2 \| 1 \|/u);
    });

    it('explains an empty log instead of rendering an empty table', () => {
        const markdown = renderCrawlerMarkdown(aggregateCrawlerLines([]));
        assert.match(markdown, /没有发现爬虫请求/u);
    });
});
