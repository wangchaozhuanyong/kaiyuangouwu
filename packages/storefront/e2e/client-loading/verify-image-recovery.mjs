import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPreviewServer } from './preview-server.mjs';

// Built shared storefront components and existing anonymous synthetic fixtures only.
// The fixture rejects business writes and has no upstream, database or credentials.
const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const dist = path.resolve(project, process.env.IMAGE_RECOVERY_QA_DIST ?? 'packages/storefront/dist');
const output = path.resolve(
    project,
    process.env.IMAGE_RECOVERY_QA_OUTPUT ??
        'docs/local-validation/navigation-recovery-20261017/image-browser',
);
assert.ok(dist.startsWith(project + path.sep), "Use this project's built storefront");
assert.ok(output.startsWith(project + path.sep), 'Evidence must stay in this project');
const assets = await readdir(path.join(dist, 'assets'));
assert.equal(
    assets.some(file => /^image-recovery-.*\.js$/u.test(file)),
    false,
    'Local image recovery must not depend on a separate fallible network module',
);
await mkdir(output, { recursive: true });
await writeFile(
    path.join(output, 'artifact-inputs.json'),
    JSON.stringify(
        {
            dist,
            fixture: 'client-loading/preview-server.mjs: synthetic local product-1',
            files: await Promise.all(
                [
                    'index.html',
                    ...assets.filter(file => /\.(?:js|css)$/u.test(file)).map(file => 'assets/' + file),
                ]
                    .sort()
                    .map(async file => ({
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

const server = createPreviewServer({ dist, defaults: { qaSsi: 'hot' } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
let failed = false;
const widths = (process.argv.find(value => value.startsWith('--widths='))?.split('=')[1] ?? '1440,390')
    .split(',')
    .map(Number);
assert.ok(widths.every(width => width === 390 || width === 1440));
const cases = new Set(
    (process.argv.find(value => value.startsWith('--cases='))?.split('=')[1] ?? 'images,not-found').split(
        ',',
    ),
);

function geometryDifference(before, after) {
    assert.ok(before && after, 'The original image frame must remain present');
    const delta = Object.fromEntries(
        ['x', 'y', 'width', 'height'].map(key => [key, Math.abs(before[key] - after[key])]),
    );
    assert.ok(
        Object.values(delta).every(value => value <= 1),
        `Image geometry shifted: ${JSON.stringify(delta)}`,
    );
    return delta;
}

try {
    for (const width of cases.has('images') ? widths : []) {
        const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 900 },
            reducedMotion: width === 390 ? 'reduce' : 'no-preference',
            serviceWorkers: 'block',
        });
        const page = await context.newPage();
        const imageRequests = [];
        const recoveryModuleRequests = [];
        const documentRequests = [];
        const pageErrors = [];
        await page.addInitScript(() => {
            const history = { events: [], states: [] };
            window.__imageRecoveryQA = history;
            for (const event of ['online', 'offline'])
                window.addEventListener(event, () => {
                    history.events.push({ event, at: performance.now(), online: navigator.onLine });
                });
            document.addEventListener('DOMContentLoaded', () => {
                let previous;
                new MutationObserver(() => {
                    const observedFrame = document.querySelector(
                        'main a[href$="id=product-1"] .safe-image-frame',
                    );
                    const image = observedFrame?.querySelector('img.safe-image');
                    const state = {
                        state: observedFrame?.getAttribute('data-safe-image'),
                        src: image?.getAttribute('src') ?? null,
                    };
                    const key = JSON.stringify(state);
                    if (key !== previous) {
                        history.states.push({ at: performance.now(), ...state });
                        previous = key;
                    }
                }).observe(document.documentElement, {
                    subtree: true,
                    childList: true,
                    attributes: true,
                    attributeFilter: ['src', 'data-safe-image'],
                });
            });
        });
        let allowImage = false;
        let frameVisibility;
        let releaseInitialImage;
        const initialImage = new Promise(resolve => {
            releaseInitialImage = resolve;
        });
        const frame = page.locator('main a[href$="id=product-1"] .safe-image-frame').first();
        const retry = page.getByRole('button', { name: /日常随行杯 1.*重试加载图片/u });
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('request', request => {
            if (request.resourceType() === 'document') documentRequests.push(request.url());
            if (/\/image-recovery-[^/]+\.js(?:[?#]|$)/u.test(request.url()))
                recoveryModuleRequests.push(request.url());
        });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort('blockedbyclient');
            if (/^\/assets\/(?:preview|source)\/product-1\.svg$/u.test(url.pathname)) {
                imageRequests.push({
                    at: Date.now(),
                    path: url.pathname,
                    preset: url.searchParams.get('preset'),
                    allowed: allowImage,
                });
                if (imageRequests.length === 1) await initialImage;
                if (!allowImage)
                    return route.fulfill({
                        status: 503,
                        contentType: 'text/plain',
                        headers: { 'cache-control': 'no-store' },
                        body: 'Synthetic local image failure',
                    });
            }
            return route.continue();
        });

        try {
            await page.goto(`${origin}/zh/category?collectionId=collection-daily&childId=collection-cups`, {
                waitUntil: 'domcontentloaded',
            });
            await expect(frame).toBeVisible();
            const before = await frame.boundingBox();
            releaseInitialImage();
            await expect(frame).toHaveAttribute('data-safe-image', 'error');
            await expect(retry).toBeVisible();
            await expect(retry).toBeEnabled();
            const firstFailureGeometry = geometryDifference(before, await frame.boundingBox());
            assert.equal(
                await retry.evaluate(button => !!button.closest('a, button button')),
                false,
                'The retry must remain outside the product link',
            );
            assert.ok(imageRequests.length >= 2, 'Both selected and bounded recovery candidates must fail');
            await page.screenshot({ path: path.join(output, `${width}-initial-error.png`) });

            const beforeOnline = imageRequests.length;
            frameVisibility = await frame.evaluate(element => {
                const ancestors = [];
                for (let node = element; node; node = node.parentElement) {
                    const style = getComputedStyle(node);
                    const rect = node.getBoundingClientRect();
                    ancestors.push({
                        tag: node.tagName,
                        className: node.className,
                        rect: rect.toJSON(),
                        overflowX: style.overflowX,
                        overflowY: style.overflowY,
                        display: style.display,
                        visibility: style.visibility,
                        opacity: style.opacity,
                        inert: node.hasAttribute('inert'),
                    });
                }
                return ancestors;
            });
            await context.setOffline(true);
            await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
            await context.setOffline(false);
            await expect.poll(() => imageRequests.length).toBeGreaterThan(beforeOnline);
            await expect(frame).toHaveAttribute('data-safe-image', 'error');
            await expect(retry).toBeVisible();
            const afterOnline = imageRequests.length;
            await context.setOffline(true);
            await context.setOffline(false);
            await page.evaluate(
                () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            );
            assert.equal(
                imageRequests.length,
                afterOnline,
                'A second online event must not replay image recovery',
            );
            await expect(frame).toHaveAttribute('data-safe-image', 'error');
            const secondFailureGeometry = geometryDifference(before, await frame.boundingBox());
            await page.screenshot({ path: path.join(output, `${width}-online-retry-error.png`) });

            allowImage = true;
            await retry.click();
            await expect(frame).toHaveAttribute('data-safe-image', 'ready', { timeout: 15_000 });
            await expect(frame.locator('img.safe-image')).toBeVisible();
            assert.equal(
                await frame
                    .locator('img.safe-image')
                    .evaluate(image => image.complete && image.naturalWidth > 0),
                true,
            );
            await expect(retry).toHaveCount(0);
            const readyGeometry = geometryDifference(before, await frame.boundingBox());
            assert.equal(documentRequests.length, 1, 'Recovery must not reload the document');
            assert.deepEqual(recoveryModuleRequests, [], 'No image recovery module may be requested');
            assert.deepEqual(pageErrors, [], 'Shared storefront must not raise browser exceptions');
            await page.screenshot({ path: path.join(output, `${width}-manual-retry-ready.png`) });
            results.push({
                width,
                status: 'PASS',
                imageRequests,
                beforeOnline,
                afterOnline,
                firstFailureGeometry,
                secondFailureGeometry,
                readyGeometry,
                documentRequests,
                recoveryModuleRequests,
                pageErrors,
                frameVisibility,
                observations: await page.evaluate(() => window.__imageRecoveryQA),
            });
        } catch (error) {
            failed = true;
            results.push({
                width,
                status: 'FAIL',
                error: String(error.stack ?? error),
                imageRequests,
                documentRequests,
                recoveryModuleRequests,
                pageErrors,
                observations: await page.evaluate(() => window.__imageRecoveryQA),
                frameVisibility,
            });
            await page.screenshot({ path: path.join(output, `${width}-failure.png`) }).catch(() => undefined);
        } finally {
            releaseInitialImage();
            await context.setOffline(false);
            await context.close();
            await writeFile(
                path.join(output, 'results.json'),
                JSON.stringify(
                    {
                        scope: 'Local built shared storefront; synthetic product imagery and data; no production verification',
                        results,
                    },
                    null,
                    2,
                ),
            );
        }
    }
    for (const width of cases.has('not-found') ? widths : []) {
        const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 900 },
            serviceWorkers: 'block',
        });
        const page = await context.newPage();
        const pageErrors = [];
        const consoleErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        await page.route('**/*', route =>
            new URL(route.request().url()).origin === origin
                ? route.continue()
                : route.abort('blockedbyclient'),
        );
        try {
            await page.goto(`${origin}/zh/missing-local-route?qaSsi=cold`, { waitUntil: 'domcontentloaded' });
            const notFound = page.locator('main.not-found-page');
            await expect(notFound).toBeVisible({ timeout: 15_000 });
            await expect(
                page.getByRole('heading', { name: /^(?:这个页面不存在|This page does not exist)$/u }),
            ).toBeVisible();
            const layout = await page.locator('.not-found-content').evaluate(element => ({
                display: getComputedStyle(element).display,
                direction: getComputedStyle(element).flexDirection,
            }));
            assert.deepEqual(
                layout,
                { display: 'flex', direction: 'column' },
                'The dedicated 404 stylesheet must load',
            );
            const homeButton = notFound.getByRole('button', {
                name: /^(?:返回.*首页|Back to Visual preset QA)$/u,
            });
            await expect(homeButton).toBeVisible();
            assert.ok(
                (await homeButton.boundingBox()).height >= 44,
                'The 404 home action needs a usable touch target',
            );
            await page.screenshot({ path: path.join(output, `${width}-not-found.png`) });
            await homeButton.click();
            await expect(page.locator('main.home-page')).toBeVisible({ timeout: 15_000 });
            await expect(notFound).toHaveCount(0);
            assert.match(
                new URL(page.url()).pathname,
                /^\/(?:(?:zh|en)\/?)?$/u,
                'The home action must navigate to the real storefront home',
            );
            assert.deepEqual(pageErrors, []);
            assert.deepEqual(consoleErrors, []);
            await page.screenshot({ path: path.join(output, `${width}-not-found-home.png`) });
            results.push({
                case: 'not-found',
                width,
                status: 'PASS',
                layout,
                homeUrl: page.url(),
                pageErrors,
                consoleErrors,
            });
        } catch (error) {
            failed = true;
            results.push({
                case: 'not-found',
                width,
                status: 'FAIL',
                error: String(error.stack ?? error),
                pageErrors,
                consoleErrors,
            });
            await page
                .screenshot({ path: path.join(output, `${width}-not-found-failure.png`) })
                .catch(() => undefined);
        } finally {
            await context.close();
            await writeFile(
                path.join(output, 'results.json'),
                JSON.stringify(
                    {
                        scope: 'Local built shared storefront; anonymous synthetic fixtures; no production verification',
                        results,
                    },
                    null,
                    2,
                ),
            );
        }
    }
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
if (failed) throw new Error(`Image recovery browser acceptance failed; see ${output}`);
process.stdout.write(
    `Local browser acceptance passed (${[...cases].join(', ')}; ${widths.join(', ')}px): ${output}\n`,
);
