import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRAFFIC_OPT_OUT_KEY } from '../../src/storefront-traffic.ts';
import { fixtureData } from '../visual-presets/fixtures.mjs';

import { createPreviewServer } from './preview-server.mjs';

// Actual built storefront; only loopback, synthetic read fixtures, and no credentials or writes.
// This checks rendering continuity, not production performance or a real authentication flow.
const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const option = (name, fallback) =>
    process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dist = path.resolve(project, option('dist', 'packages/storefront/dist'));
const output = path.resolve(
    project,
    option('output', 'docs/local-validation/navigation-continuity-20261019'),
    option('run', new Date().toISOString().replaceAll(':', '-')),
);
assert.ok(dist.startsWith(project + path.sep), 'Use a built artifact inside this project');
assert.ok(output.startsWith(project + path.sep), 'Evidence must remain inside this project');
const widths = option('widths', '390,1440').split(',').map(Number);
const identities = option('identities', 'anonymous,synthetic-customer').split(',');
const smokeOnly = option('cases', 'all') === 'consent-smoke';
assert.ok(widths.every(width => [390, 1440].includes(width)));
assert.ok(identities.every(identity => ['anonymous', 'synthetic-customer'].includes(identity)));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
const assets = (await readdir(path.join(dist, 'assets'))).filter(file => /\.(?:js|css)$/u.test(file));
const inputs = {
    dist,
    indexModifiedAt: (await stat(path.join(dist, 'index.html'))).mtime.toISOString(),
    fixture: 'client-loading/preview-server.mjs; visual-presets/fixtures.mjs synthetic activeCustomer',
    noProductionRequests: true,
    scriptSha256: createHash('sha256')
        .update(await readFile(fileURLToPath(import.meta.url)))
        .digest('hex'),
    files: await Promise.all(
        ['index.html', ...assets.map(file => `assets/${file}`)].sort().map(async file => ({
            file,
            sha256: createHash('sha256')
                .update(await readFile(path.join(dist, file)))
                .digest('hex'),
        })),
    ),
};
await writeFile(path.join(output, 'artifact-inputs.json'), JSON.stringify(inputs, null, 2));
const server = createPreviewServer({ dist, defaults: { qaSsi: 'cold' } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const startRoute = '/zh/category?collectionId=collection-daily&childId=collection-cups';
// The preview fixture has one primary category. Reuse a second primary from the
// existing dense fixture, with no products, to exercise a genuine parent switch.
const extraPrimary = fixtureData('neo-minimalist', false, 'dense').collections.items[1];
function withExtraPrimary(collections) {
    return collections.some(collection => collection.id === extraPrimary.id)
        ? collections
        : [...collections, extraPrimary];
}

function installObserver() {
    window.__continuityQA = {
        phase: null,
        samples: [],
        events: [],
        nodes: {},
        start(name, retainCategory = true) {
            this.phase = name;
            this.samples = [];
            this.events = [];
            this.retainCategory = retainCategory;
            const desktop = matchMedia('(min-width: 1024px)').matches;
            this.nodes = {
                category: document.querySelector(
                    desktop ? '.category-responsive-sidebar' : '.category-navigation-viewport',
                ),
                primary: document.querySelector(
                    desktop ? '.desktop-local-navigation' : '.primary-categories',
                ),
                secondary: document.querySelector(
                    desktop ? '.desktop-subcategory-sidebar' : '#category-subcategories',
                ),
                main: [...document.querySelectorAll('nav[aria-label="主导航"]')].find(visible),
            };
            sample('start');
        },
        stop() {
            sample('end');
            this.phase = null;
            return { samples: this.samples, events: this.events };
        },
    };
    function visible(element) {
        if (!element || !element.isConnected || !element.getClientRects().length) return false;
        for (let node = element; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (
                node.hidden ||
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                +style.opacity === 0
            )
                return false;
        }
        return true;
    }
    function available(element) {
        return visible(element) && !element.closest('[inert],[aria-hidden="true"]');
    }
    function sample(reason) {
        const qa = window.__continuityQA;
        if (!qa.phase) return;
        const nav = qa.nodes;
        const skeletons = [
            ...document.querySelectorAll('.page-skeleton,.route-transition,.list-skeleton'),
        ].filter(visible);
        const state = {
            at: Math.round(performance.now()),
            reason,
            path: location.pathname + location.search,
            categoryConnected: !nav.category || nav.category.isConnected,
            categoryVisible: !nav.category || available(nav.category),
            primaryConnected: !nav.primary || nav.primary.isConnected,
            primaryVisible: !nav.primary || available(nav.primary),
            secondaryConnected: !nav.secondary || nav.secondary.isConnected,
            secondaryVisible: !nav.secondary || available(nav.secondary),
            mainConnected: !nav.main || nav.main.isConnected,
            mainVisible: !nav.main || available(nav.main),
            categoryPresent: !!document.querySelector('.category-page'),
            resultSkeleton: skeletons.some(node => !!node.closest('.category-results')),
            wholePageSkeleton: skeletons.some(node => !node.closest('.category-results')),
            brandVisible: [
                ...document.querySelectorAll(
                    '.brand-loading:not(.brand-loading--compact),.page-readiness-initial',
                ),
            ].some(visible),
            rootVisible: visible(document.getElementById('root')),
        };
        qa.samples.push(state);
    }
    function frame() {
        sample('frame');
        requestAnimationFrame(frame);
    }
    document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(records => {
            const qa = window.__continuityQA;
            if (!qa.phase) return;
            for (const record of records) {
                for (const removed of record.removedNodes) {
                    for (const [name, node] of Object.entries(qa.nodes)) {
                        if (node && (node === removed || removed.contains?.(node)))
                            qa.events.push({ at: Math.round(performance.now()), name, event: 'removed' });
                    }
                }
            }
            sample('mutation');
        }).observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'],
        });
        requestAnimationFrame(frame);
    });
}

try {
    for (const width of widths) {
        for (const identity of identities) {
            const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 900 },
                serviceWorkers: 'block',
                reducedMotion: 'reduce',
            });
            const page = await context.newPage();
            page.setDefaultTimeout(12_000);
            const label = `${width}-${identity}`;
            const documentRequests = [];
            const pageErrors = [];
            const consoleErrors = [];
            const blockedExternalRequests = [];
            const rejectedWrites = [];
            const apiRequests = [];
            let failCatalog = false;
            let delayCatalog = 0;
            let slowCollection = null;
            let observedCustomer = false;
            let delayedHomeModuleRequests = 0;
            let releaseHomeModule;
            const homeModuleGate = new Promise(resolve => {
                releaseHomeModule = resolve;
            });
            const customer = fixtureData('neo-minimalist', true).activeCustomer;
            await page.addInitScript(installObserver);
            // Local test input only. Avoid consent-button mutations and unrelated analytics.
            await page.addInitScript(key => localStorage.setItem(key, '1'), TRAFFIC_OPT_OUT_KEY);
            page.on('request', request => {
                if (request.resourceType() === 'document') documentRequests.push(request.url());
            });
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') consoleErrors.push(message.text());
            });
            await context.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.origin !== origin) {
                    blockedExternalRequests.push({
                        path: url.origin + url.pathname,
                        type: request.resourceType(),
                    });
                    return route.abort('blockedbyclient');
                }
                if (/\/home-page-[^/]+\.js$/u.test(url.pathname)) {
                    delayedHomeModuleRequests += 1;
                    await homeModuleGate;
                    await new Promise(resolve => setTimeout(resolve, 900));
                }
                const graph = url.pathname === '/shop-api' ? request.postDataJSON() : null;
                if (graph && /\b(?:mutation|subscription)\b/u.test(graph.query ?? '')) {
                    rejectedWrites.push({ at: Date.now(), path: url.pathname });
                    return route.fulfill({
                        status: 405,
                        body: 'Local continuity QA rejects business writes',
                    });
                }
                const aggregateCatalog =
                    url.pathname === '/_storefront/page-data' && url.searchParams.get('kind') === 'catalog';
                const graphCatalog = !!graph && /\bstorefrontCatalog\s*\(/u.test(graph.query ?? '');
                const input = aggregateCatalog
                    ? JSON.parse(url.searchParams.get('input') ?? '{}')
                    : graph?.variables?.input;
                if (aggregateCatalog || graphCatalog) {
                    const delay =
                        slowCollection && input?.collectionId === slowCollection ? 1_800 : delayCatalog;
                    apiRequests.push({
                        at: Date.now(),
                        kind: aggregateCatalog ? 'aggregate' : 'graphql',
                        input,
                        delay,
                        failed: failCatalog,
                    });
                    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                    if (failCatalog)
                        return route.fulfill({
                            status: 200,
                            contentType: 'application/json',
                            body: aggregateCatalog
                                ? JSON.stringify({ fixture: true, error: 'Synthetic catalog read failure' })
                                : JSON.stringify({ errors: [{ message: 'Synthetic catalog read failure' }] }),
                        });
                }
                if (url.pathname === '/_storefront/page-data' || graph) {
                    const response = await route.fetch();
                    const json = await response.json();
                    if (Array.isArray(json.collections))
                        json.collections = withExtraPrimary(json.collections);
                    if (Array.isArray(json.data?.collections?.items)) {
                        json.data.collections.items = withExtraPrimary(json.data.collections.items);
                        json.data.collections.totalItems = json.data.collections.items.length;
                    }
                    if (
                        identity === 'synthetic-customer' &&
                        Object.hasOwn(json.data ?? {}, 'activeCustomer')
                    ) {
                        json.data.activeCustomer = customer;
                        observedCustomer = true;
                    }
                    return route.fulfill({ response, json });
                }
                return route.continue();
            });
            const category = page.locator('.category-page');
            const resultsRegion = page.locator('.category-results');
            const child = name =>
                width === 390
                    ? page.locator('#category-subcategories').getByRole('button', { name, exact: true })
                    : page
                          .locator('.desktop-subcategory-sidebar:visible')
                          .getByRole('link', { name, exact: true });
            const primary = name =>
                width === 390
                    ? page.locator('.primary-categories').getByRole('button', { name, exact: true })
                    : page
                          .locator('.desktop-local-navigation:visible')
                          .getByRole('link', { name, exact: true });
            const mainNav = () => page.locator('nav[aria-label="主导航"]:visible');
            const product = number => resultsRegion.locator(`a[href*="id=product-${number}"]`).first();
            const settled = () => expect(resultsRegion.locator('.list-skeleton')).toHaveCount(0);
            const snapshot = name => page.screenshot({ path: path.join(output, `${label}-${name}.png`) });
            async function phase(
                name,
                action,
                {
                    categoryContinuity = true,
                    secondaryContinuity = true,
                    skeletonExpected = false,
                    hot = false,
                } = {},
            ) {
                const documentsBefore = documentRequests.length;
                const errorsBefore = pageErrors.length;
                let actionError;
                await page.evaluate(
                    ({ name: phaseName, categoryContinuity: keepCategory }) =>
                        window.__continuityQA.start(phaseName, keepCategory),
                    { name, categoryContinuity },
                );
                try {
                    await action();
                } catch (error) {
                    actionError = error.message;
                }
                const evidence = await page.evaluate(() => window.__continuityQA.stop());
                const issues = [];
                if (actionError) issues.push(actionError);
                if (!evidence.samples.length) issues.push('No rendered samples were captured');
                if (
                    categoryContinuity &&
                    evidence.samples.some(
                        sample =>
                            !sample.categoryConnected ||
                            !sample.categoryVisible ||
                            !sample.primaryConnected ||
                            !sample.primaryVisible ||
                            (secondaryContinuity && (!sample.secondaryConnected || !sample.secondaryVisible)),
                    )
                )
                    issues.push('Existing category navigation was detached or hidden');
                if (categoryContinuity && evidence.samples.some(sample => sample.wholePageSkeleton))
                    issues.push('A category change displayed a whole-page skeleton');
                if (
                    evidence.samples.some(
                        sample => !sample.mainConnected || !sample.mainVisible || !sample.rootVisible,
                    )
                )
                    issues.push('Confirmed storefront shell was detached or hidden');
                if (evidence.samples.some(sample => sample.brandVisible))
                    issues.push('Navigation replayed a brand loading screen');
                if (skeletonExpected && !evidence.samples.some(sample => sample.resultSkeleton))
                    issues.push('Slow catalog read did not show its result-area skeleton');
                if (hot && evidence.samples.some(sample => sample.resultSkeleton || sample.wholePageSkeleton))
                    issues.push('Warm navigation replaced cached content with a skeleton');
                if (documentRequests.length !== documentsBefore)
                    issues.push('SPA navigation requested another document');
                if (pageErrors.length !== errorsBefore) issues.push('Browser exception during navigation');
                await snapshot(name);
                await writeFile(
                    path.join(output, `${label}-${name}.json`),
                    JSON.stringify({ name, width, identity, issues, evidence }, null, 2),
                );
                results.push({
                    width,
                    identity,
                    name,
                    status: issues.length ? 'FAIL' : 'PASS',
                    issues,
                    samples: evidence.samples.length,
                    documentRequests: documentRequests.length - documentsBefore,
                });
                process.stdout.write(
                    `${label} ${name}: ${issues.length ? 'FAIL' : 'PASS'}${issues.length ? ` — ${issues.join('; ')}` : ''}\n`,
                );
            }
            try {
                await page.goto(`${origin}${startRoute}`, { waitUntil: 'domcontentloaded' });
                await expect(category).toBeVisible();
                await expect(product(1)).toBeVisible();
                await settled();
                await expect(mainNav()).toBeVisible();
                if (identity === 'synthetic-customer') await expect.poll(() => observedCustomer).toBe(true);
                assert.equal(await page.evaluate(() => innerWidth), width);
                await snapshot('initial');

                delayCatalog = 900;
                if (smokeOnly) {
                    const componentStart = results.length;
                    await phase(
                        'consent-category',
                        async () => {
                            await child('其他用品').click();
                            await page.waitForTimeout(300);
                            await snapshot('category-pending-300ms');
                            await expect(product(13)).toBeVisible();
                            await settled();
                            await child('随行杯').click();
                            await expect(product(1)).toBeVisible();
                            await settled();
                        },
                        { skeletonExpected: true },
                    );
                    await phase(
                        'consent-main',
                        async () => {
                            releaseHomeModule();
                            await mainNav().getByRole('link', { name: '首页', exact: true }).click();
                            await page.waitForTimeout(300);
                            await expect(category).toBeVisible();
                            await snapshot('main-code-pending-300ms');
                            await expect(page.locator('.home-page')).toBeVisible();
                            assert.ok(
                                delayedHomeModuleRequests > 0,
                                'Destination code must actually be delayed',
                            );
                            await mainNav().getByRole('link', { name: '商品', exact: true }).click();
                            await expect(category).toBeVisible();
                            await settled();
                        },
                        { categoryContinuity: false },
                    );
                    const checks = results.splice(componentStart);
                    results.push({
                        width,
                        identity,
                        name: 'consent-smoke',
                        status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
                        checks,
                    });
                    continue;
                }
                await phase(
                    'secondary-slow',
                    async () => {
                        await child('其他用品').click();
                        await page.waitForTimeout(300);
                        await snapshot('secondary-pending-300ms');
                        await expect(product(13)).toBeVisible();
                        await settled();
                    },
                    { skeletonExpected: true },
                );

                await phase(
                    'warm-history-return',
                    async () => {
                        await page.goBack();
                        await expect(product(1)).toBeVisible();
                        await settled();
                    },
                    { hot: true },
                );

                await phase(
                    'empty-category',
                    async () => {
                        await child('暂无商品').click();
                        await expect(
                            resultsRegion.getByText('当前分类没有商品', { exact: true }),
                        ).toBeVisible();
                        await settled();
                    },
                    { skeletonExpected: true },
                );

                await phase(
                    'primary-switch',
                    async () => {
                        await primary(extraPrimary.name).click();
                        await expect(
                            resultsRegion.getByText('当前分类没有商品', { exact: true }),
                        ).toBeVisible();
                        await settled();
                        await primary('日常用品').click();
                        await expect(product(1)).toBeVisible();
                        await settled();
                    },
                    { secondaryContinuity: false, skeletonExpected: true },
                );

                // A new sort gives each target a fresh query key. Clicks are actual DOM controls,
                // scheduled within one browser turn so a slow A cannot block a later B intent.
                await page.goto(`${origin}${startRoute}&sort=price-asc`, { waitUntil: 'domcontentloaded' });
                await expect(product(1)).toBeVisible();
                await settled();
                slowCollection = 'collection-other';
                await phase('rapid-latest-intent', async () => {
                    await page.evaluate(() => {
                        const buttons = [
                            ...document.querySelectorAll(
                                matchMedia('(min-width: 1024px)').matches
                                    ? '.desktop-subcategory-sidebar a'
                                    : '#category-subcategories button',
                            ),
                        ];
                        buttons.find(button => button.textContent.trim() === '其他用品')?.click();
                        setTimeout(
                            () => buttons.find(button => button.textContent.trim() === '暂无商品')?.click(),
                            60,
                        );
                        setTimeout(
                            () => buttons.find(button => button.textContent.trim() === '随行杯')?.click(),
                            120,
                        );
                    });
                    await page.waitForTimeout(2_300);
                    await expect(page).toHaveURL(/childId=collection-cups/u);
                    await expect(product(1)).toBeVisible();
                    await expect(product(13)).toHaveCount(0);
                    await settled();
                });
                slowCollection = null;

                await phase(
                    'main-navigation',
                    async () => {
                        releaseHomeModule();
                        await mainNav().getByRole('link', { name: '首页', exact: true }).click();
                        await page.waitForTimeout(300);
                        await expect(category).toBeVisible();
                        await snapshot('main-code-pending-300ms');
                        await expect(page).toHaveURL(/\/zh\/?$/u);
                        await expect(page.locator('.home-page')).toBeVisible();
                        assert.ok(
                            delayedHomeModuleRequests > 0,
                            'The destination home module must actually be delayed',
                        );
                        await mainNav().getByRole('link', { name: '商品', exact: true }).click();
                        await expect(category).toBeVisible();
                        await settled();
                    },
                    { categoryContinuity: false },
                );

                if (identity === 'synthetic-customer') {
                    await phase(
                        'customer-account-navigation',
                        async () => {
                            await mainNav().getByRole('link', { name: '我的', exact: true }).click();
                            await expect(page.locator('.account-page,.desktop-account-page')).toBeVisible();
                            await expect(page).toHaveURL(/\/account(?:[?#]|$)/u);
                            await snapshot('synthetic-account');
                            await mainNav().getByRole('link', { name: '商品', exact: true }).click();
                            await expect(category).toBeVisible();
                            await settled();
                        },
                        { categoryContinuity: false },
                    );
                }

                // Cold read failure is isolated from earlier cached data by a new browser document
                // and a new explicit filter; expected fixture errors are recorded separately.
                await page.goto(`${origin}${startRoute}&minPrice=2`, { waitUntil: 'domcontentloaded' });
                await expect(product(1)).toBeVisible();
                await settled();
                failCatalog = true;
                await phase(
                    'failure-and-retry',
                    async () => {
                        await child('其他用品').click();
                        await expect(resultsRegion.getByText('商品加载失败', { exact: true })).toBeVisible({
                            timeout: 25_000,
                        });
                        await snapshot('failure-local');
                        failCatalog = false;
                        await resultsRegion.getByRole('button', { name: '重试', exact: true }).click();
                        await expect(product(13)).toBeVisible();
                        await settled();
                    },
                    { skeletonExpected: true },
                );
                failCatalog = false;

                const beforeRefresh = documentRequests.length;
                const beforeUnload = await page.evaluate(() => {
                    const nav = document.querySelector(
                        matchMedia('(min-width: 1024px)').matches
                            ? '.category-responsive-sidebar'
                            : '.category-navigation-viewport',
                    );
                    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
                    const root = document.getElementById('root');
                    return {
                        connected: nav?.isConnected,
                        visible: !!nav?.getClientRects().length,
                        rootHidden:
                            root?.hidden ||
                            root?.hasAttribute('inert') ||
                            getComputedStyle(root).visibility === 'hidden',
                    };
                });
                await page.reload({ waitUntil: 'domcontentloaded' });
                await expect(category).toBeVisible();
                await expect(product(13)).toBeVisible();
                await settled();
                const refreshIssues = [];
                if (!beforeUnload.connected || !beforeUnload.visible || beforeUnload.rootHidden)
                    refreshIssues.push('beforeunload hid or disabled the existing page');
                if (documentRequests.length !== beforeRefresh + 1)
                    refreshIssues.push('Refresh did not produce exactly one document request');
                results.push({
                    width,
                    identity,
                    name: 'browser-refresh',
                    status: refreshIssues.length ? 'FAIL' : 'PASS',
                    issues: refreshIssues,
                    beforeUnload,
                    documentRequests: documentRequests.length - beforeRefresh,
                });
                await snapshot('refresh-ready');
            } catch (error) {
                results.push({
                    width,
                    identity,
                    name: 'scenario-setup',
                    status: 'FAIL',
                    issues: [error.stack],
                });
                await snapshot('unexpected-failure').catch(() => {
                    // Preserve the original scenario failure if its diagnostic screenshot is unavailable.
                });
            } finally {
                releaseHomeModule();
                await context.unrouteAll({ behavior: 'wait' });
                await writeFile(
                    path.join(output, `${label}-network.json`),
                    JSON.stringify(
                        {
                            documentRequests,
                            apiRequests,
                            pageErrors,
                            consoleErrors,
                            blockedExternalRequests,
                            rejectedWrites,
                            observedCustomer,
                            delayedHomeModuleRequests,
                        },
                        null,
                        2,
                    ),
                );
                if (pageErrors.length)
                    results.push({
                        width,
                        identity,
                        name: 'browser-errors',
                        status: 'FAIL',
                        issues: pageErrors,
                    });
                if (consoleErrors.length)
                    results.push({
                        width,
                        identity,
                        name: 'console-errors',
                        status: 'FAIL',
                        issues: consoleErrors,
                    });
                if (rejectedWrites.length)
                    results.push({
                        width,
                        identity,
                        name: 'unexpected-writes',
                        status: 'FAIL',
                        issues: ['A test interaction attempted a business write'],
                    });
                await context.close();
            }
        }
    }
} finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await writeFile(
        path.join(output, 'summary.json'),
        JSON.stringify(
            {
                output,
                inputs: { dist, indexModifiedAt: inputs.indexModifiedAt },
                limitations: [
                    'Local built artifact with synthetic fixtures only',
                    'Synthetic customer does not exercise credential submission or real authentication',
                    'No production or business outcome is established',
                ],
                results,
            },
            null,
            2,
        ),
    );
    process.stdout.write(`Evidence: ${output}\n`);
}
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
