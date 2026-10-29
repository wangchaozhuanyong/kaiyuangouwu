import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';

// Replay a captured PUBLIC catalog through both real production renderers.
// Original images and their actual prepared derivatives stay local; no business request leaves localhost.
const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const fixture = path.resolve(process.env.PRODUCT_MEDIA_FIXTURE ?? '');
const output = path.resolve(process.env.PRODUCT_MEDIA_OUTPUT ?? '');
assert.ok(fixture.startsWith(project + path.sep) && output.startsWith(project + path.sep));
await mkdir(output, { recursive: true });
const baseline = process.argv.includes('--baseline');
const visual = process.argv.includes('--visual');
const append = process.argv.includes('--append');
const rounds = Number(process.env.PRODUCT_MEDIA_ROUNDS ?? 5);
const width = Number(process.env.PRODUCT_MEDIA_WIDTH ?? 1659);
const height = width === 390 ? 844 : width === 1659 ? 1114 : 900;
const dpr = Number(process.env.PRODUCT_MEDIA_DPR ?? 2);
const consent = process.env.PRODUCT_MEDIA_CONSENT ?? 'unknown';
const dist = path.resolve(process.env.STOREFRONT_QA_DIST ?? path.join(project, 'packages/storefront/dist'));
const pages = baseline
    ? await Promise.all(
          ['baseline-page-data.json', 'baseline-page-two.json'].map(async file =>
              JSON.parse(await readFile(path.join(fixture, file), 'utf8')),
          ),
      )
    : JSON.parse(await readFile(path.join(fixture, 'prepared-pages.json'), 'utf8'));
const derivatives = JSON.parse(await readFile(path.join(fixture, 'derivatives.json'), 'utf8'));
const sourceHost = pages[0].scope.host;
const requestPath = '/zh/category?collectionId=49&childId=86&sort=recommended&fulfillment=all';
const require = createRequire(import.meta.url);
const render = require(path.join(dist, '.server/public-page-renderer.cjs')).renderPublicPage;
const template = await readFile(path.join(dist, 'index.html'), 'utf8');
const styles = (await readdir(path.join(dist, 'assets'))).filter(file =>
    /^account-catalog-surfaces-.*\.css$/u.test(file),
);
assert.ok(styles.length);
let slowImages = false;
let failImages = false;
const server = await startSeoFixtureServer(0, {
    listenHost: '127.0.0.1',
    readOnly: true,
    renderPage: render,
    transformHtml: () =>
        template.replace(
            '</head>',
            styles.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('') + '</head>',
        ),
    transformPage(page, { url, host }) {
        const input = JSON.parse(url.searchParams.get('input') || '{}');
        const source = pages[input.skip === 12 ? 1 : 0];
        const copy = JSON.parse(JSON.stringify(source).replaceAll(`https://${sourceHost}`, `http://${host}`));
        for (const key of Object.keys(page)) delete page[key];
        Object.assign(page, copy, { products: copy.products ?? [] });
        page.scope.host = host;
        page.generatedAt = Date.now();
    },
    async beforeRequest(request, response, url) {
        if (!url.pathname.startsWith('/assets/preview/')) return false;
        const key =
            url.pathname +
            '?' +
            new URLSearchParams({ preset: url.searchParams.get('preset'), q: url.searchParams.get('q') });
        const derivative = derivatives[key];
        if (!derivative || failImages) {
            response.writeHead(404);
            response.end('Unavailable local fixture derivative');
            return true;
        }
        if (slowImages) await new Promise(resolve => setTimeout(resolve, 2500));
        const file = path.resolve(fixture, 'media', derivative.file);
        assert.ok(file.startsWith(path.join(fixture, 'media') + path.sep));
        response.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'public,max-age=3600' });
        response.end(await readFile(file));
        return true;
    },
});
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (let round = 0; round < rounds; round++) {
        const context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: dpr,
            reducedMotion: process.env.PRODUCT_MEDIA_REDUCED === '1' ? 'reduce' : 'no-preference',
        });
        if (consent === 'denied')
            await context.addCookies([
                { name: 'storefront_analytics_consent', value: 'denied', url: origin },
            ]);
        await context.route('**/*', route =>
            new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
        );
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: 80,
            downloadThroughput: 1024 * 1024,
            uploadThroughput: 1024 * 1024,
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.addInitScript(
            ({ visual: collectGeometry }) => {
                const state = (window.__mediaQA = {
                    owned: null,
                    lcp: 0,
                    lcpEntries: [],
                    longTasks: [],
                    loads: [],
                    decodes: [],
                    frames: [],
                    nodes: [],
                    images: [],
                    intersections: [],
                });
                const NativeObserver = window.IntersectionObserver;
                window.IntersectionObserver = class extends NativeObserver {
                    constructor(callback, options) {
                        super((entries, intersectionObserver) => {
                            for (const entry of entries)
                                if (entry.isIntersecting)
                                    state.intersections.push({
                                        time: performance.now(),
                                        classes: entry.target.className,
                                        margin: options?.rootMargin,
                                        root: options?.root?.className ?? 'viewport',
                                        src: entry.target.querySelector?.('img.safe-image')?.currentSrc,
                                    });
                            callback(entries, intersectionObserver);
                        }, options);
                    }
                };
                new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) {
                        state.lcp = entry.startTime;
                        state.lcpEntries.push({
                            time: entry.startTime,
                            size: entry.size,
                            url: entry.url,
                            tag: entry.element?.tagName,
                            classes: entry.element?.className,
                            text: entry.element?.textContent?.slice(0, 80),
                        });
                    }
                }).observe({ type: 'largest-contentful-paint', buffered: true });
                new PerformanceObserver(list => {
                    for (const entry of list.getEntries())
                        state.longTasks.push({ start: entry.startTime, duration: entry.duration });
                }).observe({ type: 'longtask', buffered: true });
                document.addEventListener('storefront:app-owned', () => (state.owned = performance.now()), {
                    once: true,
                });
                document.addEventListener(
                    'load',
                    event => {
                        if (event.target instanceof HTMLImageElement)
                            state.loads.push({ time: performance.now(), src: event.target.currentSrc });
                    },
                    true,
                );
                const decode = HTMLImageElement.prototype.decode;
                HTMLImageElement.prototype.decode = function (...args) {
                    return decode.apply(this, args).then(value => {
                        state.decodes.push({ time: performance.now(), src: this.currentSrc });
                        return value;
                    });
                };
                const capture = () => {
                    if (state.nodes.length) return;
                    const cards = [...document.querySelectorAll('.product-card')];
                    if (cards.length < 12) return;
                    state.images = cards
                        .slice(0, 12)
                        .map(card => card.querySelector('img.safe-image'))
                        .filter(Boolean);
                    state.nodes = [
                        ...document.querySelectorAll('header'),
                        ...cards.slice(0, 12),
                        ...cards
                            .slice(0, 12)
                            .flatMap(card => [card.querySelector('.safe-image-frame')])
                            .filter(Boolean),
                    ];
                };
                const observer = new MutationObserver(capture);
                observer.observe(document, { childList: true, subtree: true });
                if (collectGeometry) {
                    const frame = () => {
                        const cards = [...document.querySelectorAll('.product-card')];
                        if (cards.length && state.frames.length < 1500)
                            state.frames.push({
                                time: performance.now(),
                                scrollY,
                                connected: state.nodes.every(node => node.isConnected),
                                cards: cards.slice(0, 12).map(card => {
                                    const box = card.getBoundingClientRect();
                                    const image = card.querySelector('img.safe-image');
                                    const preview = card.querySelector('img.safe-image-preview');
                                    return {
                                        x: box.x,
                                        y: box.y,
                                        w: box.width,
                                        h: box.height,
                                        state: image?.closest('[data-safe-image]')?.dataset.safeImage,
                                        src: image?.currentSrc,
                                        preview:
                                            !!preview?.complete &&
                                            preview.naturalWidth > 0 &&
                                            Number(getComputedStyle(preview).opacity) > 0,
                                        visible:
                                            !!image?.complete &&
                                            image.naturalWidth > 0 &&
                                            Number(getComputedStyle(image).opacity) > 0,
                                    };
                                }),
                            });
                        requestAnimationFrame(frame);
                    };
                    requestAnimationFrame(frame);
                }
            },
            { visual },
        );
        slowImages = visual;
        failImages = process.env.PRODUCT_MEDIA_FAIL === '1';
        const screenshots = [];
        await page.goto(origin + requestPath, { waitUntil: 'domcontentloaded' });
        if (visual) {
            for (let index = 0; index < 12; index++) {
                const file = `round-${round}-${String(index).padStart(2, '0')}.png`;
                const start = await page.evaluate(() => performance.now());
                await page.screenshot({ path: path.join(output, file) });
                screenshots.push({ file, start, end: await page.evaluate(() => performance.now()) });
                await page.waitForTimeout(160);
            }
        }
        await page.waitForFunction(() => document.documentElement.hasAttribute('data-storefront-app-owned'), {
            timeout: 20000,
        });
        await page.waitForTimeout(visual ? 1200 : 2400);
        const result = await page.evaluate(() => {
            const state = window.__mediaQA;
            return {
                owned: state.owned,
                lcp: state.lcp,
                lcpEntries: state.lcpEntries,
                fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
                longTasks: state.longTasks,
                loads: state.loads,
                decodes: state.decodes,
                frames: state.frames,
                intersections: state.intersections,
                continuous: state.nodes.length > 0 && state.nodes.every(node => node.isConnected),
                imageContinuous: state.images.length > 0 && state.images.every(node => node.isConnected),
                serverImageCount: state.images.length,
                nodeIdentity: state.nodes.map(node => ({
                    tag: node.tagName,
                    classes: node.className,
                    connected: node.isConnected,
                    src: node.currentSrc,
                })),
                resources: performance
                    .getEntriesByType('resource')
                    .filter(
                        item =>
                            item.name.includes('/assets/preview/') ||
                            item.name.includes('/_storefront/page-data'),
                    )
                    .map(item => ({
                        name: item.name,
                        start: item.startTime,
                        end: item.responseEnd,
                        bytes: item.encodedBodySize,
                    })),
                cards: [...document.querySelectorAll('.product-card')].slice(0, 12).map(card => {
                    const image = card.querySelector('img.safe-image');
                    const box = image?.getBoundingClientRect();
                    return {
                        width: box?.width,
                        src: image?.currentSrc,
                        sizes: image?.sizes,
                        state: image?.closest('[data-safe-image]')?.dataset.safeImage,
                        preview: !!card.querySelector('img.safe-image-preview'),
                        ready: !!image?.complete && image?.naturalWidth > 0,
                    };
                }),
            };
        });
        results.push({ round, width, height, dpr, errors, screenshots, ...result });
        await writeFile(
            path.join(output, 'results.json'),
            JSON.stringify({ baseline, visual, consent, dist, results }, null, 2),
        );
        if (!baseline) {
            assert.equal(errors.length, 0, errors.join('\n'));
            assert.equal(result.continuous, true, 'SSR nodes must remain connected');
            if (!failImages)
                assert.equal(result.imageContinuous, true, 'Healthy SSR image nodes must remain connected');
            assert.equal(result.cards.length, 12);
            if (failImages)
                assert.ok(
                    result.cards.every(card => card.preview),
                    'Failure must retain inline previews',
                );
            if (visual && result.frames.length) {
                const first = result.frames[0].cards;
                for (const frame of result.frames)
                    for (const [index, card] of frame.cards.entries()) {
                        assert.ok(
                            card.preview || card.visible,
                            'Every sampled image frame must retain matching pixels',
                        );
                        for (const key of ['x', 'y', 'w', 'h'])
                            assert.ok(
                                Math.abs(card[key] - first[index][key]) <= 2,
                                'Stable card anchor: ' + key,
                            );
                    }
            }
        }
        if (append && !baseline) {
            failImages = true;
            await page.locator('.category-pagination-status').scrollIntoViewIfNeeded();
            await page.waitForFunction(() => document.querySelectorAll('.product-card').length === 15);
            await page.waitForTimeout(300);
            const appended = await page.evaluate(() =>
                [...document.querySelectorAll('.product-card')].slice(12).map(card => {
                    const preview = card.querySelector('img.safe-image-preview');
                    return {
                        name: card.querySelector('.product-card-name')?.textContent,
                        preview: !!preview?.complete && preview.naturalWidth > 0,
                        height: card.getBoundingClientRect().height,
                    };
                }),
            );
            await page.screenshot({ path: path.join(output, `round-${round}-appended.png`) });
            await writeFile(path.join(output, 'appended.json'), JSON.stringify(appended, null, 2));
            assert.equal(appended.length, 3);
            assert.ok(
                appended.every(card => card.preview),
                'Appended products retain their own inline previews',
            );
        }
        await context.close();
    }
} finally {
    await browser.close();
    await server.close();
}
process.stdout.write(
    JSON.stringify({
        baseline,
        visual,
        width,
        dpr,
        rounds: results.length,
        continuous: results.map(item => item.continuous),
        errors: results.map(item => item.errors),
        fcp: results.map(item => item.fcp),
        lcp: results.map(item => item.lcp),
    }),
);
