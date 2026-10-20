import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPreviewServer } from './preview-server.mjs';
import { installSiteFixture } from './site-interaction-fixture.mjs';

// Real built application, loopback-only synthetic reads. No credential submission or writes.
const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const option = (name, fallback) =>
    process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dist = path.resolve(project, option('dist', 'packages/storefront/dist'));
const output = path.resolve(
    project,
    option('output', 'docs/local-validation/site-interaction-unification-20261019/route/browser'),
    option('run', new Date().toISOString().replaceAll(':', '-')),
);
assert.ok(dist.startsWith(project + path.sep));
assert.ok(output.startsWith(project + path.sep));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
const files = [
    'index.html',
    ...(await readdir(path.join(dist, 'assets')))
        .filter(file => /\.(?:js|css)$/u.test(file))
        .map(file => `assets/${file}`),
];
await writeFile(
    path.join(output, 'artifact-inputs.json'),
    JSON.stringify(
        {
            dist,
            scriptSha256: createHash('sha256')
                .update(await readFile(fileURLToPath(import.meta.url)))
                .digest('hex'),
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
const cases = option('cases', 'scroll,scroll-first,scroll-wheel,auth,wait-ownership').split(',');
assert.ok(widths.every(width => [390, 1440].includes(width)));
const fixtureDefaults = { qaSsi: 'cold', qaPreset: 'neo-minimalist' };
const server = createPreviewServer({ dist, defaults: fixtureDefaults });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const width of widths)
        for (const name of cases) {
            const language = width === 390 ? 'zh' : 'en';
            // Router normalizes unknown query keys, so the server must retain
            // this synthetic theme for subsequent reads as well as the document.
            fixtureDefaults.qaPreset = width === 390 ? 'classic' : 'neo-minimalist';
            const record = {
                width,
                language,
                name,
                checks: [],
                homeModules: 0,
                homeResponses: 0,
                sourceReads: 0,
                canceledSourceReads: 0,
            };
            const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 900 },
                serviceWorkers: 'block',
                reducedMotion: width === 390 ? 'reduce' : 'no-preference',
            });
            let releaseHome;
            let releaseSource;
            const homeGate = new Promise(resolve => {
                releaseHome = resolve;
            });
            const sourceGate = new Promise(resolve => {
                releaseSource = resolve;
            });
            const network = await installSiteFixture(context, origin, {
                customer: false,
                intercept: async ({ request, url, graph }) => {
                    if (/\/home-page-[^/]+\.js$/u.test(url.pathname)) {
                        record.homeModules++;
                        await homeGate;
                    }
                    const aggregate =
                        url.pathname === '/_storefront/page-data' &&
                        url.searchParams.get('kind') === 'catalog';
                    const input = aggregate
                        ? JSON.parse(url.searchParams.get('input') ?? '{}')
                        : graph?.variables?.input;
                    if (
                        name === 'wait-ownership' &&
                        (aggregate || /\bstorefrontCatalog\s*\(/u.test(graph?.query ?? '')) &&
                        input?.collectionId === 'collection-other'
                    ) {
                        record.sourceReads++;
                        if (record.sourceReads === 1) await sourceGate;
                        if (request.failure()) {
                            record.canceledSourceReads++;
                            return true;
                        }
                    }
                    return false;
                },
            });
            const page = await context.newPage();
            page.setDefaultTimeout(12_000);
            const exceptions = [];
            const consoleErrors = [];
            page.on('pageerror', error => exceptions.push(error.message));
            page.on('response', response => {
                if (/\/home-page-[^/]+\.js$/u.test(new URL(response.url()).pathname)) record.homeResponses++;
            });
            page.on('console', message => {
                if (message.type() === 'error') consoleErrors.push(message.text());
            });
            const category = page.locator('.category-page');
            const boundary = page.locator('[data-page-readiness]');
            const nav = () =>
                page
                    .locator('nav[aria-label="主导航"]:visible,nav[aria-label="Main navigation"]:visible')
                    .first();
            const home = () =>
                nav().getByRole('link', { name: language === 'zh' ? '首页' : 'Home', exact: true });
            const screenshot = suffix =>
                page.screenshot({ path: path.join(output, `${width}-${name}-${suffix}.png`) });
            const readY = () =>
                page.evaluate(() => {
                    const resultsElement = document.querySelector(
                        '[data-scroll-restoration-id="category-results"]',
                    );
                    return (
                        resultsElement.scrollHeight > resultsElement.clientHeight
                            ? resultsElement
                            : document.scrollingElement
                    ).scrollTop;
                });
            const visibleAnchor = () =>
                page.evaluate(() => {
                    const resultsElement = document.querySelector('.category-results');
                    const top = Math.max(0, resultsElement.getBoundingClientRect().top);
                    const card = [...resultsElement.querySelectorAll('.product-card')].find(element => {
                        const rect = element.getBoundingClientRect();
                        return rect.top >= top && rect.top < innerHeight - 100;
                    });
                    return {
                        name: card?.querySelector('.product-card-name')?.textContent,
                        top: card?.getBoundingClientRect().top,
                        collapsed:
                            document.querySelector('.category-navigation-viewport')?.dataset.collapsed ===
                            'true',
                    };
                });
            const start = `${origin}/${language}/category?collectionId=collection-daily&childId=collection-cups&qaPreset=${width === 390 ? 'classic' : 'neo-minimalist'}`;
            try {
                await page.goto(start, { waitUntil: 'domcontentloaded' });
                await expect(category.locator('.product-card').first()).toBeVisible();
                await expect(boundary).toHaveAttribute('data-page-readiness', 'ready');
                await expect(page.locator('html')).toHaveAttribute(
                    'data-storefront-preset',
                    fixtureDefaults.qaPreset,
                );
                record.presentation = await page.evaluate(() => ({
                    preset: document.documentElement.dataset.storefrontPreset,
                    width: innerWidth,
                    height: innerHeight,
                    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
                }));
                await page.evaluate(() => {
                    window.__pendingSource = document.querySelector('.category-page');
                    const resultsElement = document.querySelector(
                        '[data-scroll-restoration-id="category-results"]',
                    );
                    window.__pendingScroll =
                        resultsElement.scrollHeight > resultsElement.clientHeight
                            ? resultsElement
                            : document.scrollingElement;
                });
                if (name === 'wait-ownership') {
                    const child =
                        width === 390
                            ? page
                                  .locator('#category-subcategories')
                                  .getByRole('button', { name: '其他用品', exact: true })
                            : page
                                  .locator('.desktop-subcategory-sidebar:visible')
                                  .getByRole('link', { name: '其他用品', exact: true });
                    await child.click();
                    await expect(category.locator('.list-skeleton')).toBeVisible();
                    await expect.poll(() => record.sourceReads).toBeGreaterThan(0);
                }
                if (name === 'scroll') {
                    await page.evaluate(() =>
                        window.__pendingScroll.scrollTo({ top: 300, behavior: 'instant' }),
                    );
                    await expect
                        .poll(() => page.evaluate(() => window.__pendingScroll.scrollTop))
                        .toBeGreaterThan(100);
                }
                if (name === 'scroll-first')
                    assert.equal(await page.evaluate(() => window.__pendingScroll.scrollTop), 0);
                const categoryNavigationHeight = await page
                    .locator('.category-navigation-viewport')
                    .evaluate(element => element.getBoundingClientRect().height)
                    .catch(() => null);
                const clickedAt = Date.now();
                // Invoke the actual link handler without Playwright scrolling a fixed/offscreen nav.
                await home().evaluate(element => element.click());
                await expect.poll(() => record.homeModules).toBeGreaterThan(0);
                await expect(category).toBeVisible();
                await expect(page.locator('.page-readiness-navigation')).toBeVisible();
                record.feedbackElapsedMs = Date.now() - clickedAt;
                assert.ok(
                    record.feedbackElapsedMs < 1800,
                    'Slow navigation must provide prompt visible feedback',
                );
                assert.ok(
                    await page.evaluate(
                        () => window.__pendingSource === document.querySelector('.category-page'),
                    ),
                );
                if (name.startsWith('scroll')) {
                    if (categoryNavigationHeight !== null) {
                        assert.equal(
                            await page
                                .locator('.category-navigation-viewport')
                                .evaluate(element => element.getBoundingClientRect().height),
                            categoryNavigationHeight,
                            'Navigation registration must not collapse category controls',
                        );
                    }
                    if (name === 'scroll-wheel') {
                        await category.locator('.category-results').hover();
                        await page.mouse.wheel(0, 600);
                        await expect
                            .poll(() => page.evaluate(() => window.__pendingScroll.scrollTop))
                            .toBeGreaterThan(100);
                        await page.waitForTimeout(400); // Finish the existing bounded header collapse motion.
                    } else {
                        await page.evaluate(() => {
                            const scroller = window.__pendingScroll;
                            scroller.scrollTo({
                                top: Math.min(700, scroller.scrollHeight - scroller.clientHeight - 20),
                                behavior: 'instant',
                            });
                        });
                    }
                    const expectedY = await page.evaluate(() => window.__pendingScroll.scrollTop);
                    assert.ok(expectedY > 100, 'Source fixture must have real document scrolling');
                    await page.waitForTimeout(180); // Let the native scroll event and browser positioning settle.
                    if (name === 'scroll-wheel') record.sourceAnchor = await visibleAnchor();
                    await screenshot('source-pending');
                    releaseHome();
                    await expect(page.locator('.home-page')).toBeVisible();
                    await expect(boundary).toHaveAttribute('data-page-readiness', 'ready');
                    await page.goBack();
                    await expect(category).toBeVisible();
                    await expect.poll(readY).toBeCloseTo(expectedY, 0);
                    record.scroll = { expected: expectedY, actual: await readY() };
                    if (name === 'scroll-wheel') {
                        record.returnedAnchor = await visibleAnchor();
                        assert.equal(record.returnedAnchor.name, record.sourceAnchor.name);
                        assert.equal(record.returnedAnchor.collapsed, record.sourceAnchor.collapsed);
                        assert.ok(
                            Math.abs(record.returnedAnchor.top - record.sourceAnchor.top) < 2,
                            'Back must retain the same visible product anchor after a real wheel gesture',
                        );
                    }
                    record.checks.push(
                        'source keeps DOM and owns scroll during pending target; back restores latest source position',
                    );
                    await screenshot('returned');
                } else if (name === 'auth') {
                    const open =
                        width === 390
                            ? nav().getByRole('link', {
                                  name: language === 'zh' ? '我的' : 'Account',
                                  exact: true,
                              })
                            : page
                                  .locator('.proto-header-right')
                                  .getByRole('link', { name: 'Sign in', exact: true });
                    await open.click();
                    const dialog = page.locator('.auth-dialog');
                    await expect(dialog).toBeVisible();
                    await dialog.locator('input[type="email"]').fill('draft@example.invalid');
                    await expect(page).toHaveURL(/\/category\?.*auth=login/u);
                    releaseHome();
                    await expect.poll(() => record.homeResponses).toBeGreaterThan(0);
                    await page.waitForTimeout(600);
                    await expect(dialog).toBeVisible();
                    await expect(dialog.locator('input[type="email"]')).toHaveValue('draft@example.invalid');
                    await expect(page).toHaveURL(/\/category\?.*auth=login/u);
                    await expect(page.locator('.home-page')).toHaveCount(0);
                    await screenshot('late-target');
                    await page.keyboard.press('Escape');
                    await expect(dialog).toHaveCount(0);
                    await expect(category).toBeVisible();
                    await expect(open).toBeFocused();
                    // Hidden category panels remain inert by design; the overlay
                    // must release its actual background owner and visible controls.
                    assert.equal(await page.locator('#root').getAttribute('inert'), null);
                    assert.ok(await category.evaluate(element => !element.closest('[inert]')));
                    assert.ok(await nav().evaluate(element => !element.closest('[inert]')));
                    assert.notEqual(
                        await page.evaluate(() => getComputedStyle(document.body).overflow),
                        'hidden',
                    );
                    record.checks.push(
                        'new source login replaces old target; late module completion preserves overlay and email draft; Escape restores focus and scroll lock',
                    );
                    await category.locator('.category-results').hover();
                    await page.mouse.wheel(0, 600);
                    await expect.poll(readY).toBeGreaterThan(100);
                    await page.waitForTimeout(400);
                    record.sourceAnchor = await visibleAnchor();
                    const expectedY = await readY();
                    await home().evaluate(element => element.click());
                    await expect(page.locator('.home-page')).toBeVisible();
                    await expect(boundary).toHaveAttribute('data-page-readiness', 'ready');
                    await page.goBack();
                    await expect(category).toBeVisible();
                    await expect.poll(readY).toBeCloseTo(expectedY, 0);
                    record.scroll = { expected: expectedY, actual: await readY() };
                    record.returnedAnchor = await visibleAnchor();
                    assert.equal(record.returnedAnchor.name, record.sourceAnchor.name);
                    assert.equal(record.returnedAnchor.collapsed, record.sourceAnchor.collapsed);
                    assert.ok(Math.abs(record.returnedAnchor.top - record.sourceAnchor.top) < 2);
                    record.checks.push(
                        'login background replacement retains the subsequent wheel gesture and visible product on return',
                    );
                    await screenshot('returned');
                } else if (name === 'wait-ownership') {
                    await screenshot('both-pending');
                    const localError = category.locator('.page-readiness-inline-error');
                    const navigationError = page.locator('.page-readiness-overlay');
                    await expect(localError).toBeVisible({ timeout: 12_000 });
                    await expect(navigationError).toBeVisible();
                    await expect(boundary).toHaveAttribute('data-navigation-readiness', 'error');
                    await expect(category.locator('.list-skeleton')).toHaveCount(0);
                    await screenshot('both-timeouts');
                    const retryName = language === 'zh' ? '重新尝试' : 'Try again';
                    await navigationError.getByRole('button', { name: retryName, exact: true }).click();
                    await expect(boundary).toHaveAttribute('data-navigation-readiness', 'preparing');
                    await expect(localError).toBeVisible();
                    const sourceCount = record.sourceReads;
                    await expect(page.locator('.page-readiness-navigation')).toBeVisible();
                    await localError.getByRole('button', { name: retryName, exact: true }).click();
                    await expect(boundary).toHaveAttribute('data-navigation-readiness', 'preparing');
                    await expect.poll(() => record.sourceReads).toBe(sourceCount + 1);
                    await expect(category.getByText('日常随行杯 13', { exact: true })).toBeVisible();
                    await expect(page.locator('.page-readiness-navigation')).toBeVisible();
                    await expect(localError).toHaveCount(0);
                    await screenshot('source-recovered-target-pending');
                    // The replacement read must recover without waiting for the old
                    // stalled read, whose later completion cannot reclaim the source.
                    releaseSource();
                    await expect.poll(() => record.canceledSourceReads).toBe(1);
                    await expect(category.getByText('日常随行杯 13', { exact: true })).toBeVisible();
                    assert.equal(record.sourceReads, sourceCount + 1);
                    releaseHome();
                    await expect(page.locator('.home-page')).toBeVisible();
                    await expect(boundary).toHaveAttribute('data-page-readiness', 'ready');
                    await expect(page.locator('.page-readiness-overlay')).toHaveCount(0);
                    record.checks.push(
                        'source local wait does not suppress target feedback; separate 10-second errors and retry clocks; ' +
                            'retry cancels exactly the stalled source read and recovers before its late completion',
                    );
                }
                assert.deepEqual(exceptions, []);
                assert.deepEqual(consoleErrors, []);
                assert.deepEqual(network.rejectedWrites, []);
                assert.deepEqual(network.fixtureErrors, []);
                assert.deepEqual(network.externalRequests, []);
                record.status = 'PASS';
            } catch (error) {
                record.status = 'FAIL';
                record.error = String(error.stack ?? error);
                await screenshot('failed').catch(() => {
                    // Preserve the original scenario failure if its diagnostic screenshot is unavailable.
                });
                await writeFile(
                    path.join(output, `${width}-${name}-failed.txt`),
                    await page
                        .locator('body')
                        .innerText()
                        .catch(() => ''),
                );
            } finally {
                releaseHome();
                releaseSource();
                record.exceptions = exceptions;
                record.consoleErrors = consoleErrors;
                record.network = network;
                results.push(record);
                process.stdout.write(`${width} ${name}: ${record.status}\n`);
                await context.close();
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
                results,
                limitations: [
                    'Local built application with synthetic read fixtures only',
                    'No credential submission, production mutation, payment, or regional network measurement',
                ],
            },
            null,
            2,
        ),
    );
}
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
