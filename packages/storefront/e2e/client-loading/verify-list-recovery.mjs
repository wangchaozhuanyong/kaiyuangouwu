import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPreviewServer } from './preview-server.mjs';
import { installSiteFixture } from './site-interaction-fixture.mjs';

const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const option = (name, fallback) =>
    process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dist = path.resolve(project, option('dist', 'packages/storefront/dist'));
const output = path.resolve(
    project,
    option('output', 'docs/local-validation/site-interaction-unification-20261019/lists'),
    option('run', new Date().toISOString().replaceAll(':', '-')),
);
assert.ok(dist.startsWith(project + path.sep));
assert.ok(output.startsWith(project + path.sep));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
const files = [
    'index.html',
    ...(await readdir(path.join(dist, 'assets')))
        .filter(name => /\.(js|css)$/u.test(name))
        .map(name => `assets/${name}`),
];
await writeFile(
    path.join(output, 'artifact-inputs.json'),
    JSON.stringify(
        {
            dist,
            files: await Promise.all(
                files.sort().map(async file => ({
                    file,
                    sha256: createHash('sha256')
                        .update(await readFile(path.join(dist, file)))
                        .digest('hex'),
                })),
            ),
        },
        null,
        2,
    ),
);
const widths = option('widths', '390,1440').split(',').map(Number);
const failFast = option('fail-fast', '1') !== '0';
const cases = option(
    'cases',
    'search-offline,search-page-reset,search-total,orders-recovery,search-timeout,orders-timeout,' +
        'search-append-timeout,orders-append-timeout,search-append-offline,orders-append-offline',
).split(',');
assert.ok(widths.every(width => [390, 1440].includes(width)));
const results = [];
const defaults = { qaSsi: 'cold' };
const server = createPreviewServer({ dist, defaults });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
    scenarios: for (const width of widths)
        for (const name of cases) {
            const record = {
                name,
                width,
                identity: name.startsWith('orders') ? 'synthetic-customer' : 'anonymous',
                checks: [],
                catalogReads: [],
                listReads: [],
                abandonedReads: [],
            };
            defaults.qaPreset = width === 390 ? 'classic' : 'neo-minimalist';
            const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 900 },
                locale: 'en-US',
                reducedMotion: width === 390 ? 'reduce' : 'no-preference',
                serviceWorkers: 'block',
            });
            let failAppend = name === 'orders-recovery';
            let delayedReads = 0;
            const heldReads = new Set();
            const abandoned = new Set();
            const noteAbandoned = request => {
                if (heldReads.has(request) && request.failure() && !abandoned.has(request)) {
                    abandoned.add(request);
                    record.abandonedReads.push({ failure: request.failure() });
                }
            };
            context.on('requestfailed', noteAbandoned);
            let releaseRead;
            const delayedRead = new Promise(resolve => {
                releaseRead = resolve;
            });
            const network = await installSiteFixture(context, origin, {
                customer: name.startsWith('orders'),
                intercept: async ({ route, request, url, graph, source }) => {
                    if (
                        url.pathname === '/_storefront/page-data' &&
                        url.searchParams.get('kind') === 'catalog'
                    ) {
                        const input = JSON.parse(url.searchParams.get('input') ?? '{}');
                        record.catalogReads.push(input);
                        if (
                            ((name === 'search-timeout' && input.term && input.take === 12) ||
                                (name === 'search-append-timeout' && (input.skip ?? 0) > 0)) &&
                            delayedReads++ === 0
                        ) {
                            heldReads.add(request);
                            await delayedRead;
                            if (request.failure()) {
                                noteAbandoned(request);
                                await route.abort('aborted');
                                return true;
                            }
                        }
                        if (name === 'search-total' && (input.skip ?? 0) >= 12) {
                            const response = await route.fetch();
                            const json = await response.json();
                            json.catalog = { items: json.catalog.items.slice(0, 3), totalItems: 15 };
                            await route.fulfill({ response, json });
                            return true;
                        }
                    }
                    if (graph && name.startsWith('orders')) {
                        if (
                            name === 'orders-recovery' &&
                            /\bStorefrontCustomerRecentOrders\b/u.test(graph.query)
                        ) {
                            record.checks.push({ summary: 'injected-failure' });
                            await route.fulfill({
                                json: { errors: [{ message: 'Synthetic recent summary unavailable' }] },
                            });
                            return true;
                        }
                        if (/\bStorefrontOrders\b/u.test(graph.query)) {
                            const skip = graph.variables.options.skip;
                            record.listReads.push(skip);
                            if (
                                (name === 'orders-timeout' ||
                                    (name === 'orders-append-timeout' && skip > 0)) &&
                                delayedReads++ === 0
                            ) {
                                heldReads.add(request);
                                await delayedRead;
                                if (request.failure()) {
                                    noteAbandoned(request);
                                    await route.abort('aborted');
                                    return true;
                                }
                            }
                            if (skip > 0 && failAppend) {
                                await route.fulfill({
                                    json: { errors: [{ message: 'Synthetic next page unavailable' }] },
                                });
                            } else {
                                const base = source.order ?? source.activeCustomer.orders.items[0];
                                await route.fulfill({
                                    json: {
                                        data: {
                                            activeCustomer: {
                                                orders: {
                                                    items: [
                                                        {
                                                            ...base,
                                                            id: skip ? 'qa-order-second' : 'qa-order-first',
                                                            code: skip ? 'QA-SECOND' : 'QA-FIRST',
                                                            state: 'Delivered',
                                                        },
                                                    ],
                                                    totalItems: name === 'orders-timeout' ? 1 : 2,
                                                },
                                            },
                                        },
                                    },
                                });
                            }
                            return true;
                        }
                    }
                    return false;
                },
            });
            const page = await context.newPage();
            const exceptions = [];
            page.on('pageerror', error => exceptions.push(error.message));
            page.setDefaultTimeout(12_000);
            const searchHref = (params = '') =>
                `${origin}/en/search?qaPreset=${width === 390 ? 'classic' : 'neo-minimalist'}${params}`;
            const searchInput = () => page.locator('.search-header input[role="combobox"]');
            const checkFooterGeometry = async feedback => {
                const geometry = await feedback.evaluate(node => {
                    const area = node.closest('.search-results, .orders-page');
                    const cards = [...area.querySelectorAll('.product-card, .order-card')];
                    const rect = node.getBoundingClientRect();
                    const text = node.querySelector('span, p').getBoundingClientRect();
                    return {
                        top: rect.top,
                        width: rect.width,
                        messageWidth: text.width,
                        lastCardBottom: Math.max(...cards.map(card => card.getBoundingClientRect().bottom)),
                    };
                });
                assert.ok(
                    geometry.top >= geometry.lastCardBottom - 1,
                    'Pagination feedback must follow all cards, not occupy a product grid cell',
                );
                assert.ok(
                    geometry.messageWidth >= Math.min(200, geometry.width / 2),
                    'Pagination error text must have readable line width',
                );
                record.checks.push({ footerGeometry: geometry });
            };
            try {
                if (name.includes('-append-')) {
                    const searching = name.startsWith('search');
                    const offline = name.endsWith('offline');
                    await page.goto(
                        searching
                            ? searchHref('&term=日常')
                            : `${origin}/orders?qaPreset=${width === 390 ? 'classic' : 'neo-minimalist'}`,
                        { waitUntil: 'domcontentloaded' },
                    );
                    const area = page.locator(searching ? '.search-results' : '.orders-page');
                    const card = searching ? '.product-card' : '.order-card';
                    await expect(area.locator(card)).toHaveCount(searching ? 12 : 1);
                    await page.evaluate(
                        selector => {
                            window.__appendFirst = document.querySelector(selector);
                        },
                        `${searching ? '.search-results' : '.orders-page'} ${card}`,
                    );
                    if (offline) await context.setOffline(true);
                    await area.locator(searching ? '.search-load-more' : '.order-load-more').click();
                    const feedback = area.locator(
                        offline
                            ? searching
                                ? '.search-load-error'
                                : '.order-list .inline-error'
                            : '.page-readiness-inline-error',
                    );
                    await expect(feedback).toBeVisible({ timeout: 15_000 });
                    if (offline) await expect(feedback).toContainText('offline');
                    await expect(page.locator('.page-readiness-overlay')).toHaveCount(0);
                    await checkFooterGeometry(feedback);
                    await expect(
                        area.locator(searching ? '.search-load-more' : '.order-load-more'),
                    ).toHaveCount(0);
                    await feedback.scrollIntoViewIfNeeded();
                    await page.screenshot({ path: path.join(output, `${width}-${name}-recovery.png`) });
                    await feedback
                        .getByRole('button', { name: offline ? 'Retry' : 'Try again', exact: true })
                        .click();
                    if (offline) await context.setOffline(false);
                    await expect(area.locator(card)).toHaveCount(searching ? 24 : 2);
                    assert.ok(
                        await page.evaluate(
                            selector => window.__appendFirst === document.querySelector(selector),
                            `${searching ? '.search-results' : '.orders-page'} ${card}`,
                        ),
                    );
                    assert.equal(
                        searching ? record.catalogReads.at(-1).skip : record.listReads.at(-1),
                        searching ? 12 : 1,
                    );
                    assert.equal(
                        searching
                            ? record.catalogReads.filter(input => input.skip > 0).length
                            : record.listReads.filter(skip => skip > 0).length,
                        offline ? 1 : 2,
                    );
                    releaseRead();
                    if (!offline) await expect.poll(() => record.abandonedReads.length).toBe(1);
                    await expect(area.locator(card)).toHaveCount(searching ? 24 : 2);
                    record.checks.push(
                        offline
                            ? 'offline append recovery stays in footer; exact card survives; reconnection resumes only next page'
                            : 'timeout retry cancels the stalled append and reads that page once; exact card survives; canceled old response cannot overwrite recovery',
                    );
                } else if (name.endsWith('timeout')) {
                    const searching = name.startsWith('search');
                    await page.goto(
                        searching
                            ? searchHref()
                            : `${origin}/orders?qaPreset=${width === 390 ? 'classic' : 'neo-minimalist'}`,
                        { waitUntil: 'domcontentloaded' },
                    );
                    if (searching) {
                        await expect(searchInput()).toBeVisible();
                        await searchInput().fill('日常');
                        await searchInput().press('Enter');
                    }
                    const area = page.locator(searching ? '.search-results' : '.orders-page');
                    await expect(area.locator('.page-readiness-inline-error')).toBeVisible({
                        timeout: 15_000,
                    });
                    await expect(area.locator('.list-skeleton, [data-page-pending]')).toHaveCount(0);
                    await expect(page.locator('.page-readiness-overlay')).toHaveCount(0);
                    await page.screenshot({ path: path.join(output, `${width}-${name}-timeout.png`) });
                    await area
                        .locator('.page-readiness-error')
                        .getByRole('button', { name: 'Try again', exact: true })
                        .click();
                    await expect(area.locator(searching ? '.product-card' : '.order-card')).toHaveCount(
                        searching ? 12 : 1,
                    );
                    await expect(area.locator('.page-readiness-inline-error')).toHaveCount(0);
                    assert.equal(
                        searching
                            ? record.catalogReads.filter(input => input.term && input.take === 12).length
                            : record.listReads.length,
                        2,
                    );
                    releaseRead();
                    await expect.poll(() => record.abandonedReads.length).toBe(1);
                    await expect(area.locator(searching ? '.product-card' : '.order-card')).toHaveCount(
                        searching ? 12 : 1,
                    );
                    record.checks.push(
                        '10 second deadline replaces skeleton locally; retry cancels stalled read and starts one new read; ' +
                            'recovery completes before abandoned response is released',
                    );
                } else if (name === 'search-offline') {
                    await page.goto(searchHref(), { waitUntil: 'domcontentloaded' });
                    await expect(searchInput()).toBeVisible();
                    await expect(page.locator('[data-page-readiness]')).toHaveAttribute(
                        'data-page-readiness',
                        'ready',
                    );
                    await context.setOffline(true);
                    await searchInput().fill('offline-unseen-term');
                    await searchInput().press('Enter');
                    await expect(page.locator('.search-results')).toContainText('Search unavailable');
                    await expect(page.locator('.search-results')).toContainText('offline');
                    await expect(page.locator('.search-results .list-skeleton')).toHaveCount(0);
                    await page.screenshot({ path: path.join(output, `${width}-${name}-offline.png`) });
                    record.checks.push('uncached offline search displays recovery without skeleton');
                    await page
                        .locator('.search-results')
                        .getByRole('button', { name: 'Retry', exact: true })
                        .click();
                    await expect(page.locator('.search-results')).toContainText('offline');
                    await context.setOffline(false);
                    await expect(page.locator('.search-empty')).toBeVisible();
                    record.checks.push(
                        'offline retry stays recoverable; reconnection resumes the read and resolves to confirmed empty result',
                    );
                } else if (name === 'search-page-reset') {
                    await page.goto(searchHref('&term=日常&page=2'), { waitUntil: 'domcontentloaded' });
                    await expect(page.locator('.search-results .product-card')).toHaveCount(12);
                    await expect(page.locator('.search-results')).toContainText('日常随行杯 13');
                    assert.ok(record.catalogReads.some(input => input.skip === 12));
                    await page.locator('.search-sort button').nth(1).click();
                    await expect.poll(() => new URL(page.url()).searchParams.has('page')).toBe(false);
                    await expect
                        .poll(() =>
                            record.catalogReads.some(
                                input => input.sort === 'NAME' && (input.skip ?? 0) === 0,
                            ),
                        )
                        .toBe(true);
                    await page.goto(searchHref('&term=日常&page=2'), { waitUntil: 'domcontentloaded' });
                    await expect(searchInput()).toBeVisible();
                    await searchInput().fill('随行杯');
                    await searchInput().press('Enter');
                    await expect.poll(() => new URL(page.url()).searchParams.has('page')).toBe(false);
                    await expect
                        .poll(() =>
                            record.catalogReads.some(
                                input => input.term === '随行杯' && (input.skip ?? 0) === 0,
                            ),
                        )
                        .toBe(true);
                    await expect(page.locator('.search-results .product-card')).toHaveCount(12);
                    record.checks.push('page 2 starts at offset 12; sort and keyword return to offset 0');
                } else if (name === 'search-total') {
                    await page.goto(searchHref('&term=日常'), { waitUntil: 'domcontentloaded' });
                    await expect(page.locator('.search-results .product-card')).toHaveCount(12);
                    await page.locator('.search-load-more').click();
                    await expect(page.locator('.search-results .product-card')).toHaveCount(15);
                    await expect(page.locator('.search-results-heading')).toContainText('15 items');
                    await expect(page.locator('.search-load-more')).toHaveCount(0);
                    record.checks.push('latest total 15 replaces first total 24 and removes load more');
                } else if (name === 'orders-recovery') {
                    await page.goto(
                        `${origin}/orders?qaPreset=${width === 390 ? 'classic' : 'neo-minimalist'}`,
                        { waitUntil: 'domcontentloaded' },
                    );
                    await expect(page.locator('.orders-page .order-card')).toHaveCount(1);
                    await expect(page.locator('.order-tabs')).toBeVisible();
                    if (width === 1440)
                        await expect(page.locator('.order-tabs button').first()).toContainText('2');
                    assert.ok(record.checks.some(check => check.summary === 'injected-failure'));
                    await page.evaluate(() => {
                        window.__listRecoveryCard = document.querySelector('.orders-page .order-card');
                        window.__listRecoveryTabs = document.querySelector('.order-tabs');
                    });
                    await page.locator('.order-load-more').click();
                    await expect(page.locator('.order-list .inline-error')).toBeVisible();
                    await checkFooterGeometry(page.locator('.order-list .inline-error'));
                    await expect(page.locator('.orders-page .order-card')).toHaveCount(1);
                    await page.screenshot({
                        path: path.join(output, `${width}-${name}-pagination-error.png`),
                    });
                    assert.ok(
                        await page.evaluate(
                            () =>
                                window.__listRecoveryCard ===
                                    document.querySelector('.orders-page .order-card') &&
                                window.__listRecoveryTabs === document.querySelector('.order-tabs'),
                        ),
                    );
                    failAppend = false;
                    await page
                        .locator('.order-list .inline-error')
                        .getByRole('button', { name: 'Retry', exact: true })
                        .click();
                    await expect(page.locator('.orders-page .order-card')).toHaveCount(2);
                    await expect(page.locator('.order-list .inline-error')).toHaveCount(0);
                    await expect(page.locator('.order-load-more')).toHaveCount(0);
                    assert.ok(
                        await page.evaluate(
                            () =>
                                window.__listRecoveryCard ===
                                document.querySelector('.orders-page .order-card'),
                        ),
                    );
                    assert.equal(record.listReads.at(-1), 1);
                    record.checks.push(
                        'summary failure does not gate orders; append failure preserves exact card and tabs; local retry appends once',
                    );
                } else throw new Error(`Unknown case ${name}`);
                assert.equal(await page.evaluate(() => innerWidth), width);
                record.actualPreset = await page.locator('html').getAttribute('data-storefront-preset');
                record.documentLanguage = await page.locator('html').getAttribute('lang');
                record.reducedMotion = await page.evaluate(
                    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
                );
                assert.equal(record.actualPreset, defaults.qaPreset);
                assert.deepEqual(network.rejectedWrites, []);
                assert.deepEqual(network.fixtureErrors, []);
                assert.deepEqual(exceptions, []);
                record.status = 'PASS';
                await page.screenshot({ path: path.join(output, `${width}-${name}.png`) });
            } catch (error) {
                record.status = 'FAIL';
                record.error = error.message;
                record.text = (
                    await page
                        .locator('body')
                        .innerText()
                        .catch(() => '')
                ).slice(0, 3500);
                await page
                    .screenshot({ path: path.join(output, `${width}-${name}-failure.png`) })
                    .catch(() => {
                        // Preserve the original scenario failure if its diagnostic screenshot is unavailable.
                    });
            } finally {
                await context.setOffline(false);
                releaseRead();
                await context.unrouteAll({ behavior: 'wait' });
                record.network = network;
                record.exceptions = exceptions;
                results.push(record);
                await writeFile(path.join(output, 'progress.json'), JSON.stringify(results, null, 2));
                process.stdout.write(`${width} ${name}: ${record.status}\n`);
                await context.close();
            }
            if (record.status === 'FAIL' && failFast) break scenarios;
        }
} finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await writeFile(
        path.join(output, 'summary.json'),
        JSON.stringify(
            {
                scope: 'Actual built client; loopback synthetic read-only fixtures; no production or business outcome measurement.',
                requested: { widths, cases },
                aborted: results.length < widths.length * cases.length,
                results,
            },
            null,
            2,
        ),
    );
}
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
