import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import test from 'node:test';
import vm from 'node:vm';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';

import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';

import { applyCouponScenario } from './coupon-fixture.mjs';
import { summarizeReport } from './report-summary.mjs';
import {
    applyReviewedHomeStructure,
    inheritScenario,
    requestScenario,
    resolveDistRoot,
    scenarioParameters,
} from './scenario-fixture.mjs';
import { installTextCompression, negotiatedEncoding } from './text-compression.mjs';

test('coupon fixtures represent prepared, unknown, empty and late public inputs without identity', () => {
    const page = {};
    applyCouponScenario(page, 'coupons');
    assert.deepEqual(page, { couponAudience: 'anonymous', couponCampaigns: [] });
    applyCouponScenario(page, 'old');
    assert.deepEqual(page, {});
    applyCouponScenario(page, 'targeted');
    assert.equal(page.couponAudience, 'unknown');
    assert.equal(page.couponCampaigns.length, 1);
    applyCouponScenario(page, 'prepared');
    assert.equal(page.couponAudience, 'anonymous');
    assert.equal(page.couponCampaigns[0].claimed, false);
    assert.equal(page.couponCampaigns[0].claimable, true);
    assert.equal('customerId' in page.couponCampaigns[0], false);
    applyCouponScenario(page, 'late');
    assert.deepEqual(page, {});
    applyCouponScenario(page, 'late', true);
    assert.equal(page.couponAudience, 'anonymous');
    assert.equal(page.couponCampaigns.length, 1);
});

test('loading fixture serves synthetic SSR and refuses every GraphQL write operation', async t => {
    const server = await startSeoFixtureServer(0, {
        listenHost: '127.0.0.1',
        readOnly: true,
        renderPage: async () => '<main>synthetic body</main>',
        transformHtml: async (_route, page) =>
            `<html><head><title>QA</title></head><body><div id="root"></div>
            <script type="module" src="/assets/mock.js"></script><i>${page.scope.channelCode}</i></body></html>`,
        beforeRequest: async (_request, response, url) => {
            if (url.pathname !== '/__qa/health') return false;
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ synthetic: true }));
            return true;
        },
    });
    t.after(() => server.close());
    const origin = `http://127.0.0.1:${server.port}`;
    const document = await fetch(origin + '/zh/').then(response => response.text());
    assert.match(document, /data-public-rendered="1"/u);
    assert.match(document, /synthetic body/u);
    assert.match(document, /storefront-public-page-data/u);
    assert.deepEqual(await fetch(origin + '/__qa/health').then(response => response.json()), {
        synthetic: true,
    });
    for (const input of [
        { query: 'mutation Purchase { purchase }' },
        { query: 'subscription Updates { updates }' },
        { query: 'query Read { activeCustomer } mutation Purchase { purchase }', operationName: 'Read' },
        { query: 'mutation { claimStorefrontCoupon(campaignId: "qa-prepared-coupon") { id } }' },
    ]) {
        const response = await fetch(origin + '/shop-api', { method: 'POST', body: JSON.stringify(input) });
        assert.equal(response.status, 405);
        assert.match(JSON.stringify(await response.json()), /Read-only local fixture/u);
    }
    const read = await fetch(origin + '/shop-api', {
        method: 'POST',
        body: JSON.stringify({ query: 'query Read { activeCustomer }' }),
    });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).data.activeCustomer, null);
});

test('scenario delay applies to the selected product images and survives same-origin resource referers', () => {
    const params = scenarioParameters('product-images', 'candidate', 'geometry');
    const reference = 'http://127.0.0.1:5198/zh/?' + params;
    const product = inheritScenario(new URL('http://127.0.0.1:5198/assets/preview/product-1.svg'), reference);
    assert.equal(requestScenario(product).delay, 2000);
    assert.equal(requestScenario(product).syntheticImage, true);
    const hero = inheritScenario(new URL('http://127.0.0.1:5198/qa/hero-desktop.svg'), reference);
    assert.equal(requestScenario(hero).delay, 0);
    assert.equal(
        requestScenario(new URL('http://127.0.0.1:5198/assets/preview/product-1.svg?qaCase=image-error'))
            .failImage,
        true,
    );
    const code = inheritScenario(
        new URL('http://127.0.0.1:5198/assets/index.js'),
        'http://127.0.0.1:5198/zh/?' + scenarioParameters('slow', 'candidate'),
    );
    assert.equal(requestScenario(code).delay, 1600);
    assert.equal(
        inheritScenario(
            new URL('http://127.0.0.1:5198/assets/index.js'),
            'https://external.invalid/?qaCodeDelay=5000',
        ).search,
        '',
    );
    assert.equal(
        requestScenario(new URL('http://127.0.0.1:5198/qa/hero-mobile.svg?qaImageCache=warm')).cache,
        'public, max-age=300',
    );
});

test('selected dist can only belong to this repository or an internal worktree', () => {
    const project = '/project/repo/.codex-worktrees/candidate';
    const identity = value => value;
    assert.equal(resolveDistRoot(project, undefined, identity), project + '/packages/storefront/dist');
    const baseline = '/project/repo/.codex-worktrees/baseline/packages/storefront/dist';
    assert.equal(resolveDistRoot(project, baseline, identity), baseline);
    assert.throws(() => resolveDistRoot(project, '../dist', identity), /absolute/u);
    assert.throws(() => resolveDistRoot(project, '/other/packages/storefront/dist', identity), /belong/u);
    assert.throws(
        () =>
            resolveDistRoot(project, baseline, value =>
                value === baseline ? '/elsewhere/packages/storefront/dist' : value,
            ),
        /belong/u,
    );
});

test('reviewed fixture preserves public product identity and has the reviewed module order', () => {
    const products = Array.from({ length: 12 }, (_, index) => ({ id: `product-${index + 1}` }));
    const page = {
        products,
        content: {
            blocks: [
                { id: 'hero', type: 'HERO', enabled: true, settings: {} },
                {
                    id: 'quick',
                    type: 'QUICK_LINKS',
                    items: Array.from({ length: 5 }, (_, i) => ({ id: String(i) })),
                },
            ],
            settings: { configuredBlockTypes: ['HERO', 'QUICK_LINKS'] },
        },
    };
    applyReviewedHomeStructure(page);
    const blocks = page.content.blocks.toSorted((a, b) => a.position - b.position);
    assert.deepEqual(
        blocks.map(block => block.type),
        [
            'NOTICE',
            'HERO',
            'HERO',
            'HERO',
            'QUICK_LINKS',
            'BEST_SELLERS',
            'RECOMMENDATIONS',
            'FEATURED_COLLECTION',
            'FEATURED_COLLECTION',
            'STORY',
        ],
    );
    assert.deepEqual(page.products, products);
    assert.equal(blocks[1].settings.heroArtworkLayout, 'campaign');
    assert.equal(blocks[4].items.length, 5);
    assert.equal(blocks[1].settings.mobileHeroTranslations[0].title, '手机合成工具商城');
    assert.equal(new Set(blocks.filter(block => block.type === 'HERO').map(block => block.imageUrl)).size, 3);
    assert.equal(
        new Set(blocks.filter(block => block.type === 'HERO').map(block => block.settings.mobileImageUrl))
            .size,
        3,
    );
    assert.equal(page.content.settings.heroAutoplayIntervalSeconds, 5);
    assert.deepEqual(
        blocks[7].settings.selectedProductIds,
        products.slice(0, 7).map(product => product.id),
    );
    assert.equal(blocks[7].settings.displayCount, 7);
    assert.equal(page.content.systemAnnouncements.length, 1);
    assert.equal('activeCustomer' in page, false);
});

test('performance summary never turns unmeasured geometry or images into successful zeroes', () => {
    const summary = summarizeReport({
        mode: 'performance',
        samples: [{ at: 500, scrollY: 120, appOwned: true }],
        events: [{ type: 'storefront:app-owned', at: 250 }],
        viewport: { width: 390 },
        shifts: [],
    });
    assert.equal(summary.firstOwned, 250);
    assert.equal(summary.geometryMeasured, false);
    assert.equal(summary.heroReplaced, null);
    assert.equal(summary.couponAppearedAfterFirstHomeFrame, null);
    assert.equal(summary.couponPlaceholderFrames, null);
    assert.deepEqual(summary.imageCandidates, []);
});

test('image summary joins candidate-specific resource timing without claiming real pixels', () => {
    const summary = summarizeReport({
        mode: 'geometry',
        samples: [],
        shifts: [],
        viewport: { width: 390 },
        imageHistory: [
            {
                nodeId: 1,
                candidate: '/assets/p.webp?preset=small',
                firstViewportAt: 500,
                firstDrawableAt: 800,
            },
        ],
        resources: [{ path: '/assets/p.webp?preset=small', initiator: 'img', startAt: 200, endAt: 790 }],
    });
    assert.equal(summary.imageCandidates[0].requestBeforeViewportMs, 300);
    assert.equal(summary.imageCandidates[0].viewportToDrawableMs, 300);
    assert.match(summary.imageCandidates[0].actualPixels, /unmeasured/u);
});

test('performance observer avoids forced layout, captures modulepreloads and records only trusted clicks', async () => {
    const source = await readFile(new URL('./observe.js', import.meta.url), 'utf8');
    const listeners = new Map();
    const timers = [];
    const frames = [];
    const uploads = [];
    const observers = [];
    let clock = 0;
    const target = { tagName: 'BUTTON', isConnected: true, disabled: false, getAttribute: () => null };
    const document = {
        documentElement: { hasAttribute: () => false },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (name, callback) => listeners.set(name, callback),
        getAnimations: () => {
            throw new Error('Performance mode must not inspect animation geometry');
        },
    };
    const context = {
        URL,
        URLSearchParams,
        Blob,
        console,
        document,
        location: {
            search: '?qaMode=performance',
            href: 'http://127.0.0.1:5198/zh/',
            origin: 'http://127.0.0.1:5198',
            pathname: '/zh/',
        },
        history: { state: {} },
        innerWidth: 390,
        innerHeight: 844,
        scrollY: 0,
        sessionStorage: {
            getItem: () => null,
            setItem() {
                return undefined;
            },
        },
        localStorage: {
            setItem() {
                return undefined;
            },
        },
        performance: { now: () => clock, getEntriesByType: () => [] },
        PerformanceObserver: class {
            constructor(callback) {
                this.callback = callback;
            }
            observe(options) {
                observers.push({ type: options.type, callback: this.callback });
            }
        },
        getComputedStyle: () => {
            throw new Error('Performance mode forced style/layout');
        },
        matchMedia: () => ({ matches: false }),
        requestAnimationFrame: callback => {
            frames.push(callback);
            return frames.length;
        },
        cancelAnimationFrame() {
            return undefined;
        },
        setTimeout: callback => {
            timers.push(callback);
            return timers.length;
        },
        clearTimeout() {
            return undefined;
        },
        addEventListener: (name, callback) => listeners.set(name, callback),
        parent: {
            postMessage() {
                return undefined;
            },
        },
        fetch: (_url, options) => {
            uploads.push(JSON.parse(options.body));
            return Promise.resolve({ json: async () => ({ saved: 'qa.json' }) });
        },
    };
    vm.runInNewContext(source, context);
    assert.equal(frames.length, 0, 'Performance sampling must not start a per-frame loop');
    timers.shift()();
    observers
        .find(observer => observer.type === 'resource')
        .callback({
            getEntries: () => [
                {
                    name: 'http://127.0.0.1:5198/assets/catalog-route-pages-Ab12CD34.js',
                    initiatorType: 'other',
                    startTime: 323.9,
                    responseStart: 400,
                    responseEnd: 950.4,
                    duration: 626.5,
                    transferSize: 1000,
                    decodedBodySize: 3000,
                },
            ],
        });
    const click = listeners.get('click');
    click({ isTrusted: false, target: { closest: () => target } });
    click({ isTrusted: true, target: { closest: () => target } });
    assert.equal(frames.length, 1, 'One trusted click gets one frame-opportunity measurement');
    target.disabled = true;
    clock = 20;
    // First pending timeout is the next light sample; the next one is the click check.
    timers[1]();
    listeners.get('pagehide')();
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].inputs.length, 1);
    assert.equal(uploads[0].inputs[0].feedbackMs, 20);
    assert.equal(uploads[0].samples[0].geometry, undefined);
    assert.equal(uploads[0].samples[0].images, undefined);
    assert.equal(uploads[0].resources.length, 1);
    assert.equal(uploads[0].resources[0].initiator, 'other');
    assert.equal(uploads[0].resources[0].path, '/assets/catalog-route-pages-Ab12CD34.js');
    assert.equal(uploads[0].resources[0].startAt, 323.9);
    assert.equal(uploads[0].resources[0].endAt, 950.4);
    assert.match(uploads[0].evidence.pixels, /not-captured/u);
});

test('loading-only text transport negotiates gzip/br and preserves original document, JS and CSS bytes', async t => {
    const source = Buffer.from('合成 finite response; const value = 42; .card { color: red; }\n'.repeat(500));
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        installTextCompression(request, response, url.searchParams.get('mode') ?? 'auto');
        const type = url.searchParams.get('type') ?? 'text/html; charset=utf-8';
        const precompressed = url.searchParams.has('precompressed');
        const body = precompressed ? gzipSync(source) : source;
        response.writeHead(200, {
            'content-type': type,
            'content-length': body.length,
            vary: 'Origin',
            ...(precompressed ? { 'content-encoding': 'gzip' } : {}),
        });
        response.write(body.subarray(0, 50));
        response.end(body.subarray(50));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const read = (pathname, accept) =>
        new Promise((resolve, reject) => {
            http.get(
                {
                    host: '127.0.0.1',
                    port: server.address().port,
                    path: pathname,
                    headers: { 'Accept-Encoding': accept },
                },
                response => {
                    const parts = [];
                    response.on('data', chunk => parts.push(chunk));
                    response.on('end', () =>
                        resolve({ headers: response.headers, body: Buffer.concat(parts) }),
                    );
                },
            ).on('error', reject);
        });
    for (const type of [
        'text/html; charset=utf-8',
        'text/javascript',
        'application/javascript',
        'text/css',
    ]) {
        for (const encoding of ['gzip', 'br']) {
            const response = await read('/?type=' + encodeURIComponent(type), encoding);
            assert.equal(response.headers['content-encoding'], encoding);
            assert.equal(response.headers['content-type'], type);
            assert.equal(Number(response.headers['content-length']), response.body.length);
            assert.match(response.headers.vary, /Origin, Accept-Encoding/u);
            assert.deepEqual(
                encoding === 'br' ? brotliDecompressSync(response.body) : gunzipSync(response.body),
                source,
            );
            assert.ok(response.body.length < source.length);
        }
    }
    const plain = await read('/?mode=off', 'br, gzip');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(plain.body, source);
    const image = await read('/?type=image%2Fsvg%2Bxml', 'br, gzip');
    assert.equal(image.headers['content-encoding'], undefined);
    assert.deepEqual(image.body, source);
    const existing = await read('/?precompressed=1', 'br, gzip');
    assert.equal(existing.headers['content-encoding'], 'gzip');
    assert.deepEqual(gunzipSync(existing.body), source);
    const forbidden = await read('/', 'gzip;q=0, br;q=0');
    assert.equal(forbidden.headers['content-encoding'], undefined);
    assert.deepEqual(forbidden.body, source);
    assert.equal(negotiatedEncoding('gzip;q=1, br;q=0.5'), 'gzip');
    assert.equal(negotiatedEncoding('br, gzip'), 'br');
    assert.equal(negotiatedEncoding('br, gzip', 'gzip'), 'gzip');
    assert.equal(negotiatedEncoding('gzip', 'br'), null);
});

test('summary uses native FCP and ownership for handover gap and separates steady long tasks', () => {
    const report = {
        mode: 'performance',
        paints: [{ name: 'first-contentful-paint', at: 120 }],
        appOwnedAtDocumentTime: 600,
        samples: [{ at: 1000, contentPresent: true, appOwned: true }],
        longTasks: [
            { at: 300, duration: 150 },
            { at: 650, duration: 60 },
            { at: 900, duration: 85 },
        ],
    };
    const summary = summarizeReport(report);
    assert.equal(summary.firstContent, 1000);
    assert.match(summary.firstContentMeaning, /not paint/u);
    assert.equal(summary.fcp, 120);
    assert.equal(summary.visibleUnownedGapMs, 480);
    assert.equal(summary.startupMaxLongTask, 150);
    assert.deepEqual(summary.steadyLongTasks, [{ at: 900, duration: 85 }]);
    const observedOnly = summarizeReport({ ...report, appOwnedAtDocumentTime: null });
    assert.equal(observedOnly.firstOwned, 1000);
    assert.equal(observedOnly.visibleUnownedGapMs, null);
    assert.equal(observedOnly.startupMaxLongTask, null);
    const continuation = summarizeReport({
        ...report,
        sampleStarted: 20000,
        longTasks: [{ at: 23000, duration: 70 }],
    });
    assert.equal(continuation.startupMaxLongTask, 0);
    assert.deepEqual(continuation.steadyLongTasks, [{ at: 23000, duration: 70 }]);
    assert.equal(
        summarizeReport({ ...report, observerSupport: { longtask: false, 'layout-shift': false } })
            .startupMaxLongTask,
        null,
    );
});

test('preload links use only the selected renderer export, preserving legacy artifacts and existing hints', async () => {
    const source = await readFile(new URL('./preview-server.mjs', import.meta.url), 'utf8');
    // Evaluate the exported pure helper without starting the preview process or touching dist.
    const declaration = source.match(
        /export async function publicRouteModulePreloadLinks\([\s\S]*?\n\}/u,
    )?.[0];
    assert.ok(declaration);
    const links = vm.runInNewContext('(' + declaration.replace(/^export /u, '') + ')');
    const page = { request: { kind: 'home' } };
    const assetNames = ['home-page-Ab12CD34.js', 'catalog-route-pages-Ef56GH78.js'];
    let calls = 0;
    const readSource = async () => 'export const synthetic = true;';
    const renderer = {
        async getPublicRouteScriptPreloads(actualPage, actualAssets, actualReader) {
            calls++;
            assert.equal(actualPage, page);
            assert.equal(actualAssets, assetNames);
            assert.equal(actualReader, readSource);
            assert.equal(await actualReader(assetNames[0]), 'export const synthetic = true;');
            return [...assetNames, assetNames[0]];
        },
    };
    assert.equal(await links({}, page, assetNames, '<head></head>', readSource), '');
    assert.equal(
        await links(renderer, page, assetNames, '<head></head>', readSource),
        '<link rel="modulepreload" crossorigin fetchpriority="low" href="/assets/home-page-Ab12CD34.js">' +
            '<link rel="modulepreload" crossorigin fetchpriority="auto" href="/assets/catalog-route-pages-Ef56GH78.js">',
    );
    assert.equal(calls, 1);
    assert.equal(
        await links(
            renderer,
            page,
            assetNames,
            '<script src="/assets/home-page-Ab12CD34.js"></script><link href=\'/assets/catalog-route-pages-Ef56GH78.js\'>',
            readSource,
        ),
        '',
    );
    assert.equal(
        await links(
            { getPublicRouteScriptPreloads: () => [] },
            { request: { kind: 'product' } },
            assetNames,
            '',
            readSource,
        ),
        '',
    );
});

test('cold non-SSR document skips renderer preloads while normal home uses the selected artifact', async () => {
    const source = await readFile(new URL('./preview-server.mjs', import.meta.url), 'utf8');
    const helper = source.match(/export async function publicRouteModulePreloadLinks\([\s\S]*?\n\}/u)?.[0];
    const body = source.match(/async transformHtml\(route, page\) \{([\s\S]*?)\n    \},\n\}\);/u)?.[1];
    assert.ok(helper);
    assert.ok(body);
    const selectedDist = '/project/selected-artifact/dist';
    const caseKey = Symbol('fixture-case');
    const page = {
        [caseKey]: 'home',
        request: { kind: 'home' },
        visualPreset: { presetId: 'classic' },
        config: {},
    };
    let rendererCalls = 0;
    const sourceReads = [];
    let selectedReader;
    const transform = vm.runInNewContext('(async function(route, page) {' + body + '\n})', {
        caseKey,
        dist: selectedDist,
        path: { join: (...parts) => parts.join('/') },
        readFile: async (pathname, encoding) => {
            assert.equal(encoding, 'utf8');
            if (pathname === selectedDist + '/index.html')
                return '<html data-storefront-theme-pending><head></head><body></body></html>';
            assert.equal(pathname, selectedDist + '/assets/home-page-Ab12CD34.js');
            sourceReads.push(pathname);
            return 'import "./shared-Ab12CD34.js";';
        },
        readdir: async pathname => {
            assert.equal(pathname, selectedDist + '/assets');
            return ['home-page-Ab12CD34.js'];
        },
        require: pathname => {
            assert.equal(pathname, selectedDist + '/.server/public-page-renderer.cjs');
            return {
                getPublicRouteScriptPreloads: async (actualPage, actualAssets, readSource) => {
                    assert.equal(actualPage, page);
                    assert.deepEqual(actualAssets, ['home-page-Ab12CD34.js']);
                    selectedReader = readSource;
                    assert.equal(await readSource('home-page-Ab12CD34.js'), 'import "./shared-Ab12CD34.js";');
                    rendererCalls++;
                    return ['home-page-Ab12CD34.js'];
                },
            };
        },
        publicRouteModulePreloadLinks: vm.runInNewContext('(' + helper.replace(/^export /u, '') + ')'),
        resolveStorefrontSemanticPalette: () => ({}),
        semanticPaletteCssVariables: () => ({}),
        storefrontSkinCssVariables: () => ({}),
    });
    const normal = await transform('/zh/', page);
    assert.match(
        normal,
        /rel="modulepreload" crossorigin fetchpriority="low" href="\/assets\/home-page-Ab12CD34\.js"/u,
    );
    assert.equal(rendererCalls, 1);
    assert.deepEqual(sourceReads, [selectedDist + '/assets/home-page-Ab12CD34.js']);
    assert.throws(() => selectedReader('../outside.js'), /emitted JavaScript basename/u);
    assert.throws(() => selectedReader('absent-Ab12CD34.js'), /emitted JavaScript basename/u);
    page[caseKey] = 'cold';
    const cold = await transform('/zh/', page);
    assert.doesNotMatch(cold, /rel="modulepreload"/u);
    assert.equal(rendererCalls, 1, 'No renderer preload decision is invoked for the static fallback');
    assert.equal(sourceReads.length, 1, 'Cold fallback does not read route module sources');
});
