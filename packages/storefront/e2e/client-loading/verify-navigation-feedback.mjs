import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPreviewServer } from './preview-server.mjs';
import { installSiteFixture } from './site-interaction-fixture.mjs';

// Built application, synthetic loopback reads only. Never submit credentials or business writes.
const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const option = (key, fallback) =>
    process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const output = path.resolve(
    project,
    option('output', 'docs/local-validation/navigation-responsive-20261022'),
    option('run', new Date().toISOString().replaceAll(':', '-')),
);
assert.ok(output.startsWith(project + path.sep));
await mkdir(output, { recursive: true });
const defaults = { qaSsi: option('ssi', 'cold'), qaPreset: 'classic' };
const server = createPreviewServer({ dist: path.join(project, 'packages/storefront/dist'), defaults });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const cpu = Number(option('cpu', '1'));
try {
    for (const width of option('widths', '390,1440').split(',').map(Number)) {
        const record = { width, checks: [] };
        defaults.qaPreset = width === 390 ? 'classic' : 'neo-minimalist';
        const language = option('language', width === 390 ? 'zh' : 'en');
        assert.ok(['zh', 'en'].includes(language));
        record.language = language;
        record.ssi = defaults.qaSsi;
        const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 900 },
            reducedMotion: width === 390 ? 'reduce' : 'no-preference',
            serviceWorkers: 'block',
        });
        let releaseCode;
        const codeGate = new Promise(resolve => {
            releaseCode = resolve;
        });
        const network = await installSiteFixture(context, origin, {
            intercept: async ({ url }) => {
                if (/\/home-page-[^/]+\.js$/u.test(url.pathname)) await codeGate;
                return false;
            },
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
        record.cpuSlowdown = cpu;
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.__navigationFrames = [];
            window.__navigationClicks = [];
            window.__navigationLongTasks = [];
            new PerformanceObserver(list => {
                for (const entry of list.getEntries())
                    window.__navigationLongTasks.push({ at: entry.startTime, ms: entry.duration });
            }).observe({ type: 'longtask', buffered: true });
            document.addEventListener(
                'click',
                event => {
                    const anchor =
                        event.target instanceof Element ? event.target.closest('nav a[href]') : null;
                    if (anchor)
                        window.__navigationClicks.push({
                            at: performance.now(),
                            target: new URL(anchor.href).pathname,
                        });
                },
                true,
            );
            const visible = element => {
                if (!element?.getClientRects().length) return false;
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
            };
            function frame() {
                if (window.__navigationFrames.length < 3000)
                    window.__navigationFrames.push({
                        at: performance.now(),
                        path: location.pathname,
                        route: document.querySelector('[data-route]')?.dataset.route,
                        homeVisible: visible(document.querySelector('.home-page')),
                        boot: visible(document.querySelector('#storefront-boot-loading')),
                        globalIndicators: [
                            ...document.querySelectorAll(
                                '#storefront-boot-loading,.page-readiness-initial,.page-readiness-navigation',
                            ),
                        ].filter(visible).length,
                    });
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        });
        try {
            await page.goto(
                `${origin}/${language}/category?collectionId=collection-daily&childId=collection-cups`,
            );
            await expect(page.locator('.category-page .product-card').first()).toBeVisible();
            await expect(page.locator('[data-page-readiness]')).toHaveAttribute(
                'data-page-readiness',
                'ready',
            );
            const nav = () =>
                page
                    .locator('nav[aria-label="主导航"]:visible,nav[aria-label="Main navigation"]:visible')
                    .first();
            await page.evaluate(() => {
                window.__stableNavigation =
                    document.querySelector('.bottom-nav') ??
                    [...document.querySelectorAll('nav')].find(
                        element => element.getAttribute('aria-label') === 'Main navigation',
                    );
                window.__navigationClick = performance.now();
            });
            await nav()
                .getByRole('link', { name: language === 'zh' ? '首页' : 'Home', exact: true })
                .click();
            await expect(page.locator('[data-route]')).toHaveAttribute('data-route', 'home', {
                timeout: 2000,
            });
            await expect(page.locator('.category-page')).not.toBeVisible();
            await expect(
                nav().getByRole('link', { name: language === 'zh' ? '首页' : 'Home', exact: true }),
            ).toHaveAttribute('aria-current', 'page');
            await expect(page.locator('.page-readiness-navigation')).toBeVisible();
            if (width === 390)
                await expect(
                    page.locator('.storefront-pending-mobile-header .mobile-page-header'),
                ).toBeVisible();
            const geometry = await page.locator('.page-readiness-navigation').evaluate(element => {
                const rect = element.getBoundingClientRect();
                return {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    viewport: document.documentElement.clientWidth,
                    innerWidth,
                    bodyWidth: document.body.getBoundingClientRect().width,
                };
            });
            record.loadingGeometry = geometry;
            assert.ok(
                Math.abs(geometry.x + geometry.width / 2 - geometry.bodyWidth / 2) < 3,
                'Loading feedback must be horizontally centered: ' + JSON.stringify(geometry),
            );
            assert.ok(
                geometry.y > 100 && geometry.y + geometry.height < (width === 390 ? 760 : 830),
                'Loading feedback must sit inside the visible content area',
            );
            await page.screenshot({ path: path.join(output, `${width}-cold-pending.png`) });
            // Exercise the exact CSS overlap that used to suppress navigation feedback.
            // Real background-query failure rendering is covered by its component suite.
            await page.evaluate(() => {
                const notice = document.createElement('aside');
                notice.className = 'storefront-query-feedback';
                notice.dataset.qaOverlap = '';
                notice.textContent = 'Update failed. Previous content is still shown.';
                document.body.append(notice);
            });
            await expect(page.locator('.page-readiness-navigation')).toBeVisible();
            await page.locator('[data-qa-overlap]').evaluate(element => element.remove());
            record.checks.push('A separate background-error notice cannot hide target navigation feedback');
            record.checks.push(
                'Target identity and selected navigation appear while target code is blocked; source body is gone; central feedback remains visible',
            );
            // A new intent must escape the stalled destination without waiting for its code.
            await nav().locator('a[href*="/category"]').first().click();
            await expect(page.locator('.category-page .product-card').first()).toBeVisible();
            releaseCode();
            await expect(page.locator('[data-route]')).toHaveAttribute('data-route', 'category');
            await expect(page.locator('.home-page')).not.toBeVisible();
            record.checks.push('Latest navigation wins; late code cannot restore an abandoned destination');
            await nav()
                .getByRole('link', { name: language === 'zh' ? '首页' : 'Home', exact: true })
                .click();
            await expect(page.locator('.home-page')).toBeVisible();
            await expect(page.locator('[data-page-readiness]')).toHaveAttribute(
                'data-page-readiness',
                'ready',
            );
            await page.goBack();
            await expect(page.locator('.category-page')).toBeVisible();
            await page.evaluate(() => {
                window.__warmClick = performance.now();
            });
            await nav()
                .getByRole('link', { name: language === 'zh' ? '首页' : 'Home', exact: true })
                .click();
            await expect(page.locator('.home-page')).toBeVisible();
            record.warmClickToObservedContentMs = await page.evaluate(
                () => performance.now() - window.__warmClick,
            );
            await page.evaluate(
                () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            );
            record.frames = await page.evaluate(() => window.__navigationFrames);
            record.timings = await page.evaluate(() => ({
                clicks: window.__navigationClicks.map(click => {
                    const feedbackFrame = window.__navigationFrames.find(
                        frame =>
                            frame.at >= click.at &&
                            frame.path === click.target &&
                            frame.route === (click.target.endsWith('/category') ? 'category' : 'home'),
                    );
                    const content = window.__navigationFrames.find(
                        frame => frame.at >= click.at && frame.path === click.target && frame.homeVisible,
                    );
                    return {
                        target: click.target,
                        feedbackMs: feedbackFrame ? feedbackFrame.at - click.at : null,
                        contentMs: content ? content.at - click.at : null,
                    };
                }),
                longTasks: window.__navigationLongTasks,
            }));
            if (cpu === 1) {
                assert.ok(
                    record.timings.clicks.every(
                        click => click.feedbackMs !== null && click.feedbackMs <= 100,
                    ),
                    'Normal-environment navigation feedback must paint within 100ms',
                );
                assert.ok(
                    record.timings.clicks.at(-1).contentMs <= 300,
                    'Warm home content must paint within 300ms',
                );
            }
            assert.ok(
                record.frames.every(frame => frame.globalIndicators <= 1),
                'Startup and React must never display overlapping global loading surfaces',
            );
            assert.deepEqual(errors, []);
            assert.deepEqual(network.fixtureErrors, []);
            assert.deepEqual(network.rejectedWrites, []);
            assert.deepEqual(network.externalRequests, []);
            await page.screenshot({ path: path.join(output, `${width}-warm-home.png`) });
            record.status = 'PASS';
        } catch (error) {
            record.status = 'FAIL';
            record.error = String(error.stack ?? error);
            record.frames = await page.evaluate(() => window.__navigationFrames).catch(() => []);
            await page.screenshot({ path: path.join(output, `${width}-failed.png`) }).catch(() => undefined);
        } finally {
            releaseCode();
            record.errors = errors;
            record.network = network;
            results.push(record);
            await context.close();
            process.stdout.write(
                `${width}: ${record.status}${record.error ? ` ${record.error.split('\n')[0]}` : ''}\n`,
            );
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
                results,
                limitations: ['Synthetic local reads; not regional network or production business proof'],
            },
            null,
            2,
        ),
    );
}
if (results.some(record => record.status === 'FAIL')) process.exitCode = 1;
