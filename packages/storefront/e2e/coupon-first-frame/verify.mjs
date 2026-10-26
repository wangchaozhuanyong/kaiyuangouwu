// Built storefront, production SSR assembler, local synthetic reads only.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublicPage, createPreviewServer } from '../client-loading/preview-server.mjs';
import { installSiteFixture } from '../client-loading/site-interaction-fixture.mjs';
import { syntheticPage } from '../seo-public/fixtures.mjs';
import { fixtureData } from '../visual-presets/fixtures.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.join(root, 'reports/coupon-first-frame-20261026');
const baseline = process.argv.includes('--baseline');
const dist = baseline ? path.join(output, 'baseline-dist') : path.join(root, 'packages/storefront/dist');
const require = createRequire(import.meta.url);
const renderer = require(path.join(dist, '.server/public-page-renderer.cjs'));
const { assemblePublicHtml } = require(
    path.join(root, 'packages/store-management-plugin/dist/seo/storefront-seo-html.service.js'),
);
const offer = fixtureData('classic', false, 'product-coupon-quantity').activeStorefrontCoupons[0];
const inner = createPreviewServer({ dist, defaults: { qaCoupons: '1' } });
let scenario = 'prepared';
const pageData = (host, language = 'en') => {
    const page = buildPublicPage(
        { kind: 'home' },
        host,
        { coupons: '1', preset: 'classic' },
        { languageCode: language },
    );
    const sourceBlock = page.content.blocks[0];
    page.content.blocks.push({
        ...sourceBlock,
        id: 'sales',
        code: 'sales',
        type: 'BEST_SELLERS',
        enabled: true,
        title: 'Prepared products',
        imageUrl: null,
        items: [],
        position: 4,
    });
    page.content.settings.configuredBlockTypes.push('BEST_SELLERS');
    page.bestSellers = {
        catalog: { items: page.products.slice(0, 4), totalItems: 4 },
        salesByProductId: {},
        pinnedProducts: [],
        candidateCount: 16,
    };
    page.couponAudience = scenario === 'private' ? 'unknown' : 'anonymous';
    if (scenario !== 'unknown') page.couponCampaigns = scenario === 'empty' ? [] : [offer];
    page.seo = {
        ...syntheticPage('synthetic-a', language, 'home', { host }).seo,
        channelCode: page.scope.channelCode,
    };
    return page;
};
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + req.headers.host);
    if (/^\/(en|zh)?\/?$/.test(url.pathname)) {
        const language = url.pathname.includes('zh') ? 'zh_Hans' : 'en';
        const page = pageData(req.headers.host, language);
        const html = assemblePublicHtml(
            await readFile(path.join(dist, 'index.html'), 'utf8'),
            page,
            await renderer.renderPublicPage(page),
        );
        await writeFile(path.join(output, `${scenario}-ssr.html`), html);
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        res.end(html);
        return;
    }
    if (url.pathname === '/_storefront/page-data' && url.searchParams.get('kind') === 'home') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(pageData(req.headers.host, url.searchParams.get('languageCode') || 'en')));
        return;
    }
    inner.emit('request', req, res);
});
await mkdir(output, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const width of [390, 1440])
        for (const current of ['prepared', 'empty', 'unknown', 'private']) {
            scenario = current;
            const context = await browser.newContext({
                viewport: { width, height: 900 },
                serviceWorkers: 'block',
            });
            let releaseScripts;
            const scripts = new Promise(resolve => {
                releaseScripts = resolve;
            });
            let couponReads = 0;
            const network = await installSiteFixture(context, origin, {
                customer: current === 'private',
                intercept: async ({ route, url, graph }) => {
                    if (url.pathname.endsWith('.js') && url.pathname.startsWith('/assets/')) {
                        await scripts;
                        await route.continue();
                        return true;
                    }
                    if (graph?.query?.includes('activeStorefrontCoupons')) {
                        couponReads++;
                        await new Promise(resolve => setTimeout(resolve, 400));
                        await route.fulfill({
                            json: {
                                data: {
                                    activeStorefrontCoupons:
                                        current === 'private'
                                            ? [{ ...offer, claimed: true, claimable: false }]
                                            : current === 'empty'
                                              ? []
                                              : [offer],
                                },
                            },
                        });
                        return true;
                    }
                    if (
                        graph?.query?.includes('storefrontContent') &&
                        !graph.query.includes('storefrontContentItem')
                    ) {
                        const response = await route.fetch();
                        const data = await response.json();
                        if (data.data?.storefrontContent) {
                            const preparedPage = pageData(new URL(origin).host);
                            data.data.storefrontContent = preparedPage.content.blocks;
                            data.data.storefrontContentSettings = preparedPage.content.settings;
                        }
                        await route.fulfill({ response, json: data });
                        return true;
                    }
                    return false;
                },
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(String(error)));
            try {
                await page.goto(origin + '/en?qaCoupons=1', { waitUntil: 'commit' });
                await expect(page.locator('[data-home-catalog="sales"]')).toBeVisible();
                const before = await page.locator('[data-home-catalog="sales"]').boundingBox();
                const beforeCoupons = await page.locator('.coupon-hub-section').count();
                const beforeCards = await page.locator('.coupon-hub-section .desktop-coupon-ticket').count();
                await page.evaluate(() => {
                    window.couponFrames = [];
                    window.couponMeasure = true;
                    window.couponShifts = 0;
                    window.couponLcp = 0;
                    new PerformanceObserver(list => {
                        for (const entry of list.getEntries()) window.couponLcp = entry.startTime;
                    }).observe({ type: 'largest-contentful-paint', buffered: true });
                    new PerformanceObserver(list => {
                        for (const entry of list.getEntries())
                            if (!entry.hadRecentInput) window.couponShifts += entry.value;
                    }).observe({ type: 'layout-shift' });
                    const frame = () => {
                        const shelf = document.querySelector('[data-home-catalog="sales"]');
                        window.couponFrames.push(shelf ? shelf.getBoundingClientRect().top + scrollY : null);
                        if (window.couponMeasure) requestAnimationFrame(frame);
                    };
                    requestAnimationFrame(frame);
                });
                releaseScripts();
                await page.waitForFunction(
                    () => document.getElementById('root')?.dataset.publicAdopted === '1',
                );
                await page.waitForTimeout(1600);
                const after = await page.locator('[data-home-catalog="sales"]').boundingBox();
                const afterCoupons = await page.locator('.coupon-hub-section').count();
                const afterCards = await page.locator('.coupon-hub-section .desktop-coupon-ticket').count();
                const metrics = await page.evaluate(() => {
                    window.couponMeasure = false;
                    const nav = performance.getEntriesByType('navigation')[0];
                    return {
                        lcp: window.couponLcp,
                        frames: window.couponFrames,
                        clsAfterCss: window.couponShifts,
                        ttfb: nav.responseStart - nav.requestStart,
                        domInteractive: nav.domInteractive,
                        resources: performance.getEntriesByType('resource').length,
                    };
                });
                const displacement =
                    Math.max(...metrics.frames.filter(value => value !== null)) -
                    Math.min(...metrics.frames.filter(value => value !== null));
                const expected = current === 'prepared' ? 1 : 0;
                const contractFailures = [];
                if (beforeCoupons !== expected) contractFailures.push('first-frame section visibility');
                if (beforeCards !== expected) contractFailures.push('first-frame real coupon visibility');
                if (afterCoupons !== expected || afterCards !== expected)
                    contractFailures.push('late-data visibility');
                if ((current === 'prepared' || current === 'empty') && couponReads !== 0)
                    contractFailures.push('redundant prepared coupon read');
                if (!baseline) {
                    assert.deepEqual(contractFailures, []);
                    assert.equal(beforeCoupons, expected);
                    assert.equal(afterCoupons, beforeCoupons);
                    assert(displacement <= 1, `Product shelf moved ${displacement}px: ${current}/${width}`);
                    assert(Math.abs(after.y - before.y) <= 1);
                    if (current === 'prepared' || current === 'empty')
                        assert.equal(
                            couponReads,
                            0,
                            'Prepared anonymous reads must use the existing Query cache',
                        );
                    assert.equal(errors.length, 0, errors.join('\n'));
                }
                await page.screenshot({
                    path: path.join(output, `${baseline ? 'before' : 'after'}-${width}-${current}.png`),
                });
                let naturalReentry = null;
                if (!baseline && current === 'unknown') {
                    const navigation = page.locator('nav[aria-label="Main navigation"]:visible');
                    await navigation.locator('a[href*="/category"]').first().click();
                    await expect(page.locator('.category-page')).toBeVisible();
                    await navigation.getByRole('link', { name: 'Home', exact: true }).click();
                    await expect(page.locator('.coupon-hub-section')).toHaveCount(1);
                    naturalReentry = 'PASS';
                }
                results.push({
                    width,
                    scenario: current,
                    baseline,
                    beforeCoupons,
                    afterCoupons,
                    beforeCards,
                    afterCards,
                    contractFailures,
                    naturalReentry,
                    couponReads,
                    displacement,
                    ...metrics,
                    errors,
                    status: baseline ? 'OBSERVED' : 'PASS',
                });
                assert.deepEqual(network.externalRequests, []);
                assert.deepEqual(network.rejectedWrites, []);
            } catch (error) {
                await writeFile(
                    path.join(output, 'browser-failure.json'),
                    JSON.stringify(
                        {
                            scenario,
                            width,
                            error: String(error),
                            reads: network.reads,
                            body: (await page.locator('body').innerText()).slice(0, 3000),
                        },
                        null,
                        2,
                    ),
                );
                releaseScripts();
                await page
                    .screenshot({
                        path: path.join(output, 'browser-failure.png'),
                        fullPage: true,
                        timeout: 3000,
                    })
                    .catch(() => undefined);
                throw error;
            } finally {
                releaseScripts();
                await context.close();
            }
        }
    await writeFile(
        path.join(output, baseline ? 'browser-before.json' : 'browser-after.json'),
        JSON.stringify(
            {
                environment:
                    'Built storefront + production SSR assembler; local synthetic HTTP/GraphQL data, actual Chromium. ' +
                    'Script release is gated for first-frame inspection. ' +
                    'Timings are local samples, not RUM or performance acceptance.',
                results,
            },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results.map(({ frames, ...record }) => record)) + '\n');
} finally {
    await browser.close();
    inner.closeAllConnections();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
