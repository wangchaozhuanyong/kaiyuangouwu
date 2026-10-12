import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSeoFixtureServer } from './preview-server.mjs';

const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const output = path.join(project, 'docs/local-validation/experience-offline-20261013/hydration');
await mkdir(output, { recursive: true });
const widthOption = process.argv.find(argument => argument.startsWith('--width='));
const widths = widthOption ? [Number(widthOption.split('=')[1])] : [390, 1440];
assert.ok(
    widths.every(width => [390, 1440].includes(width)),
    'Only the acceptance viewports are supported',
);
const reportName = widthOption ? `warm-navigation-${widths[0]}-report.json` : 'warm-navigation-report.json';
// Bind the same address used by the browser: IPv6-only ephemeral ports can collide
// with a Docker listener on IPv4 on macOS.
const server = await startSeoFixtureServer(0, {
    listenHost: '127.0.0.1',
    transformPage(page, { url }) {
        if (url.pathname !== '/_storefront/page-data' || page.request.kind !== 'catalog') return;
        // Echo the requested aggregation identity, as the production API does. The shared
        // SEO fixture otherwise pins its catalog to the first collection and page two.
        const input = JSON.parse(url.searchParams.get('input'));
        page.request.input = input;
        page.requestKey = JSON.stringify(page.request);
        const query = new URLSearchParams();
        if (input.collectionId) query.set('collectionId', input.collectionId);
        if (input.childId) query.set('childId', input.childId);
        if (input.skip) query.set('page', String(input.skip / input.take + 1));
        page.route = '/en/category' + (query.size ? '?' + query : '');
        page.seo.requestKey = page.requestKey;
        page.seo.canonical = `http://${page.scope.host}${page.route}`;
    },
});
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const failures = [];
const percentile = (values, fraction) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

try {
    for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'en-US' });
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('request', request =>
            requests.push({ url: request.url(), resource: request.resourceType() }),
        );
        try {
            await page.goto(origin + '/en/');
            await expect(page.locator('#root')).toHaveAttribute('data-public-adopted', '1');
            await expect(page.locator('[data-page-readiness=ready]')).toBeVisible();
            await page.waitForFunction(
                () => !document.documentElement.hasAttribute('data-storefront-theme-pending'),
            );
            await page.evaluate(() => {
                const frame = document.querySelector('.storefront-app');
                const content = document.getElementById('storefront-content');
                const browserSamples = [];
                let expected;
                let active;
                document.addEventListener(
                    'click',
                    event => {
                        if (!expected || active) return;
                        const start = performance.now();
                        active = { ...expected, start, trusted: event.isTrusted, frames: 0 };
                        expected = undefined;
                        const check = () => {
                            const current = active;
                            if (!current) return;
                            current.frames += 1;
                            const ready = document.querySelector('[data-page-readiness=ready]');
                            const targetFrame = document.querySelector(
                                `.storefront-app[data-route="${current.target}"]`,
                            );
                            const targetPage = document.querySelector(current.targetSelector);
                            if (
                                ready &&
                                targetFrame &&
                                targetPage &&
                                targetPage.getBoundingClientRect().width > 0
                            ) {
                                browserSamples.push({
                                    direction: current.direction,
                                    elapsedMs: performance.now() - current.start,
                                    frames: current.frames,
                                    trusted: current.trusted,
                                    location: location.pathname + location.search,
                                    shellRetained:
                                        frame === targetFrame &&
                                        content === document.getElementById('storefront-content'),
                                    requiredPlaceholder: Boolean(
                                        content.querySelector('[data-page-pending]'),
                                    ),
                                });
                                active = undefined;
                            } else if (performance.now() - current.start < 10000)
                                requestAnimationFrame(check);
                            else {
                                browserSamples.push({
                                    direction: current.direction,
                                    failure: 'Target did not become ready within 10 seconds',
                                });
                                active = undefined;
                            }
                        };
                        requestAnimationFrame(check);
                    },
                    true,
                );
                window.__warmNavigation = {
                    arm(value) {
                        if (active || expected) throw new Error('An earlier navigation is still armed');
                        expected = value;
                    },
                    samples: browserSamples,
                };
            });
            const navigate = async (direction, target, selector) => {
                const control = page.locator(selector).first();
                await expect(control).toBeVisible();
                const count = await page.evaluate(() => window.__warmNavigation.samples.length);
                const targetSelector =
                    target === 'product'
                        ? '#storefront-content .product-detail-page'
                        : target === 'category'
                          ? width < 1024
                              ? '#storefront-content .category-page'
                              : '#storefront-content .desktop-catalog-main'
                          : '#storefront-content .home-page';
                await page.evaluate(value => window.__warmNavigation.arm(value), {
                    direction,
                    target,
                    targetSelector,
                });
                await control.click();
                await page.waitForFunction(
                    previous => window.__warmNavigation.samples.length > previous,
                    count,
                );
                const sample = await page.evaluate(() => window.__warmNavigation.samples.at(-1));
                assert.equal(sample.failure, undefined, `${width} ${direction}: ${sample.failure}`);
                assert.equal(sample.trusted, true, 'Timing starts from the actual browser click event');
                assert.equal(
                    sample.shellRetained,
                    true,
                    'Navigation must retain the shell and content container',
                );
                assert.equal(
                    sample.requiredPlaceholder,
                    false,
                    'The target must contain ready content rather than placeholders',
                );
            };
            const cycle = async () => {
                await navigate(
                    'home→product',
                    'product',
                    'a[href="/en/product?id=synthetic-a-product-1"]:visible',
                );
                await navigate(
                    'product→home',
                    'home',
                    width < 1024 ? '.product-detail-page .page-back-button' : '.proto-brand',
                );
                await navigate(
                    'home→category',
                    'category',
                    '.quick-grid a[href*="collectionId=synthetic-a-collection"]:visible',
                );
                await navigate(
                    'category→home',
                    'home',
                    width < 1024 ? '.storefront-bottom-nav a[href="/en/"]' : '.proto-brand',
                );
            };
            for (let index = 0; index < 2; index += 1) await cycle();
            await page.evaluate(
                () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            );
            const requestStart = requests.length;
            await page.evaluate(() => {
                window.__warmNavigation.samples.length = 0;
            });
            for (let index = 0; index < 10; index += 1) await cycle();
            const samples = await page.evaluate(() => window.__warmNavigation.samples);
            const measuredRequests = requests.slice(requestStart);
            const codeLoads = measuredRequests.filter(request => request.resource === 'script');
            const businessReads = measuredRequests.filter(request =>
                /\/(?:shop-api|_storefront\/page-data)(?:\?|$)/u.test(new URL(request.url).pathname),
            );
            assert.deepEqual(codeLoads, [], 'The measured destination route code must already be cached');
            assert.deepEqual(errors, [], 'Navigation must not emit errors');
            const values = samples.map(sample => sample.elapsedMs);
            const p95Ms = percentile(values, 0.95);
            const directions = Object.fromEntries(
                [...new Set(samples.map(sample => sample.direction))].map(direction => {
                    const directionValues = samples
                        .filter(sample => sample.direction === direction)
                        .map(sample => sample.elapsedMs);
                    return [
                        direction,
                        { count: directionValues.length, p95Ms: percentile(directionValues, 0.95) },
                    ];
                }),
            );
            results.push({
                width,
                warmupNavigations: 8,
                count: samples.length,
                p50Ms: percentile(values, 0.5),
                p95Ms,
                maxMs: Math.max(...values),
                targetMs: 200,
                passed: p95Ms <= 200,
                directions,
                codeLoads,
                businessReads,
                samples,
            });
        } catch (error) {
            failures.push({ width, message: error.message, errors });
            const html = await page.content().catch(() => null);
            if (html) await writeFile(path.join(output, `warm-navigation-${width}-failure.html`), html);
            await page
                .screenshot({ path: path.join(output, `warm-navigation-${width}-failure.png`) })
                .catch(() => undefined);
            throw error;
        } finally {
            await context.close();
        }
    }
} finally {
    await writeFile(
        path.join(output, reportName),
        JSON.stringify(
            {
                synthetic: true,
                mode: 'production-artifact',
                environment: 'Local Chromium, unthrottled CPU/network, synthetic 36-product catalog',
                method:
                    'Document capture of trusted click → first requestAnimationFrame containing destination route, ' +
                    'visible page and ready boundary; performance.now inside browser',
                scope: 'Warm route code and query contents after two complete UI round trips; timing excludes Playwright RPC and actionability wait',
                results,
                failures,
            },
            null,
            2,
        ),
    );
    await browser.close();
    await server.close();
}
assert.ok(
    results.length === widths.length && results.every(result => result.count >= 20 && result.passed),
    'Warm navigation p95 must be <= 200 ms on the measured viewports',
);
process.stdout.write(
    JSON.stringify({
        viewports: results.map(({ width, count, p95Ms, passed }) => ({ width, count, p95Ms, passed })),
        output,
    }) + '\n',
);
