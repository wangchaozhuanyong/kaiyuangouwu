import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSeoFixtureServer } from './preview-server.mjs';

// Real shared SSR + client components, synthetic anonymous data, localhost only.
const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const storefront = path.join(project, 'packages/storefront');
const output = path.resolve(
    project,
    process.env.CONTINUITY_QA_OUTPUT ?? 'docs/local-validation/loading-continuity-20261013/current',
);
assert.ok(output.startsWith(project + path.sep), 'Evidence must stay in this project');
await mkdir(output, { recursive: true });
const baseline = process.argv.includes('--baseline');
const dev = process.argv.includes('--dev');
const selected = new Set(
    (
        process.argv.find(value => value.startsWith('--cases='))?.split('=')[1] ??
        'hydration,navigation,race,actions,departure,cold,scope,errors,filter,currency,cart,search,scroll'
    ).split(','),
);
const widths = (
    process.argv.find(value => value.startsWith('--widths='))?.split('=')[1] ?? '390,1440,1023,1024'
)
    .split(',')
    .map(Number);
assert.ok(widths.every(width => [390, 1440, 1023, 1024].includes(width)));
const hydrationKinds = (
    process.argv.find(value => value.startsWith('--kinds='))?.split('=')[1] ?? 'catalog,product,search'
).split(',');
assert.ok(
    hydrationKinds.every(kind => ['catalog', 'product', 'search', 'services', 'support'].includes(kind)),
);
const dist = path.resolve(process.env.CONTINUITY_QA_DIST ?? path.join(storefront, 'dist'));
const require = createRequire(import.meta.url);
const mime = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};
const checks = [];
const failures = [];
let vite;
const options = { listenHost: '127.0.0.1', transformPage };
if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({
        root: storefront,
        configFile: path.join(storefront, 'vite.config.ts'),
        define: { 'import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING': JSON.stringify('false') },
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
    });
    options.renderPage = async page =>
        (await vite.ssrLoadModule('/src/entry-public-server.tsx')).renderPublicPage(page);
    options.transformHtml = async route =>
        vite.transformIndexHtml(route, await readFile(path.join(storefront, 'index.html'), 'utf8'));
    options.serveAssets = async (request, response) => {
        if (!/^\/(?:src\/|@|node_modules\/)/u.test(request.url)) return false;
        return new Promise((resolve, reject) => {
            response.once('finish', () => resolve(true));
            vite.middlewares(request, response, error => (error ? reject(error) : resolve(false)));
        });
    };
} else {
    options.renderPage = page =>
        require(path.join(dist, '.server/public-page-renderer.cjs')).renderPublicPage(page);
    const template = await readFile(path.join(dist, 'index.html'), 'utf8');
    const emittedAssets = await readdir(path.join(dist, 'assets'));
    // Match StorefrontSeoHtmlService's production route-style injection. Without this,
    // a fixture manufactures an unstyled first frame that production does not serve.
    options.transformHtml = route => {
        const prefixes = route.includes('/product')
            ? ['product-detail-page-']
            : /\/(?:category|search)/u.test(route)
              ? [
                    'account-catalog-surfaces-',
                    ...(route.includes('/search') ? ['search-loading-', 'search-page-'] : []),
                ]
              : [];
        const styles = prefixes.flatMap(prefix =>
            emittedAssets.filter(file => file.endsWith('.css') && file.startsWith(prefix)),
        );
        assert.ok(
            prefixes.every(prefix => styles.some(file => file.startsWith(prefix))),
            'Production route stylesheet must exist',
        );
        return template.replace(
            '</head>',
            styles.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('') + '</head>',
        );
    };
    options.serveAssets = async (request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (!/^\/(?:assets\/|storefront\/|legacy-browser-guard\.js|sw\.js)/u.test(pathname)) return false;
        const file = path.resolve(dist, '.' + decodeURIComponent(pathname));
        if (!file.startsWith(dist + path.sep)) return false;
        try {
            const bytes = await readFile(file);
            response.writeHead(200, {
                'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
            });
            response.end(bytes);
            return true;
        } catch {
            return false;
        }
    };
    const inputs = [
        'index.html',
        '.server/public-page-renderer.cjs',
        'storefront/restore-theme.js',
        ...[...template.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/gu)].map(match => match[1].slice(1)),
        ...emittedAssets
            .filter(file =>
                /^(?:product-detail-page-|account-catalog-surfaces-|search-loading-|search-page-).*\.css$/u.test(
                    file,
                ),
            )
            .map(file => 'assets/' + file),
    ];
    await writeFile(
        path.join(output, 'artifact-inputs.json'),
        JSON.stringify(
            {
                dist,
                files: await Promise.all(
                    [...new Set(inputs)].map(async file => ({
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
}

function transformPage(page, { url }) {
    const isSupport =
        url.pathname.endsWith('/support') ||
        (url.searchParams.get('kind') === 'page' && url.searchParams.get('id') === 'support');
    const isServices =
        url.pathname.endsWith('/services') ||
        (url.searchParams.get('kind') === 'page' && url.searchParams.get('id') === 'services');
    const isSearch = url.pathname.endsWith('/search') || url.searchParams.get('path') === '/search';
    const kind = isSearch ? 'catalog' : page.request.kind;
    page.config.currencyConfiguration = {
        availableCurrencyCodes: ['MYR', 'CNY'],
        selectorEnabled: true,
        usdtDisplayEnabled: true,
        usdtRateAvailable: true,
        usdtPaymentConfigured: true,
        myrPerUsdtRate: 4.5,
        cnyPerUsdtRate: 7,
        usdtMarkupPercent: 0,
    };
    const currency = url.searchParams.get('currencyCode') === 'CNY' ? 'CNY' : 'MYR';
    page.scope.currencyCode = currency;
    for (const product of page.products)
        for (const variant of product.variants) {
            variant.currencyCode = currency;
            if (currency === 'CNY') variant.priceWithTax *= 2;
        }
    const prefix = page.scope.languageCode === 'en' ? '/en' : '/zh';
    if (kind === 'product') {
        const id = url.searchParams.get('id') ?? page.product.id;
        page.product = page.products.find(product => product.id === id) ?? null;
        page.request = { kind: 'product', id };
        page.route = `${prefix}/product?id=${id}`;
    }
    if (kind === 'catalog') {
        const input = url.searchParams.has('input')
            ? JSON.parse(url.searchParams.get('input'))
            : {
                  ...(isSearch
                      ? { term: url.searchParams.get('term') ?? '' }
                      : { collectionId: url.searchParams.get('collectionId') ?? undefined }),
                  sort: 'RECOMMENDED',
                  inStockOnly: false,
                  skip: 0,
                  take: 12,
              };
        page.request = { kind: 'catalog', path: isSearch ? '/search' : '/category', input };
        const items = isSearch
            ? page.products.filter(product =>
                  product.name.toLowerCase().includes((input.term ?? '').toLowerCase()),
              )
            : page.products;
        page.catalog = { items, totalItems: isSearch ? items.length : 36 };
        const search = new URLSearchParams();
        if (input.collectionId) search.set('collectionId', input.collectionId);
        if (input.term) search.set('term', input.term);
        page.route = `${prefix}${isSearch ? '/search' : '/category'}${search.size ? '?' + search : ''}`;
    }
    if (isServices) {
        page.request = { kind: 'page', id: 'services' };
        page.route = prefix + '/services';
        page.content.blocks.push({
            id: 'synthetic-services',
            code: 'storefront-client-plugins',
            type: 'CLIENT_PLUGINS',
            enabled: true,
            position: 10,
            title: 'Synthetic services',
            subtitle: '',
            body: 'Synthetic anonymous service hero',
            ctaLabel: '',
            items: [],
            targetType: 'NONE',
            targetValue: null,
            imageUrl: '/qa/services-desktop.svg',
            imageAsset: { width: 2000, height: 800 },
            settings: {
                businessServicesCopyVersion: 1,
                businessServicesHeroLayout: 'image-overlay',
                mobileImageUrl: '/qa/services-mobile.svg',
                mobileImageWidth: 1000,
                mobileImageHeight: 1000,
            },
        });
    }
    if (isSupport) {
        page.request = { kind: 'page', id: 'support' };
        page.route = prefix + '/support';
        page.content.blocks.push({
            id: 'synthetic-support',
            code: 'synthetic-support',
            type: 'SUPPORT',
            enabled: true,
            position: 10,
            title: 'Synthetic support',
            subtitle: 'Local support fixture',
            body: '',
            items: [],
            settings: {
                supportFaqs: [
                    {
                        id: 'synthetic-faq',
                        enabled: true,
                        questionZh: '如何查询？',
                        questionEn: 'How can I check?',
                        answerZh: '本地合成内容',
                        answerEn: 'Synthetic local answer',
                    },
                ],
            },
        });
    }
    page.requestKey = JSON.stringify(page.request);
    page.seo.requestKey = page.requestKey;
    page.seo.canonical = `http://${page.scope.host}${page.route}`;
}

function observeFrames() {
    const samples = [];
    const events = [];
    let stopped = false;
    const box = element => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width && rect.height && style.display !== 'none' && style.visibility !== 'hidden'
            ? [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100)
            : null;
    };
    const read = () => {
        const root = document.getElementById('root');
        const shell = document.querySelector('.storefront-app');
        const content = document.getElementById('storefront-content');
        const detail = document.querySelector('.product-detail-page');
        return {
            at: Math.round(performance.now() * 100) / 100,
            href: location.pathname + location.search,
            scrollY: Math.round(window.scrollY * 100) / 100,
            categoryScrollTop:
                document.querySelector('[data-scroll-restoration-id="category-results"]')?.scrollTop ?? null,
            route: shell?.dataset.route ?? null,
            ready: document.querySelector('[data-page-readiness]')?.dataset.pageReadiness ?? null,
            adopted: root?.dataset.publicAdopted ?? null,
            content: box(content),
            header: box(document.querySelector('.proto-desktop-header')),
            page: box(content?.querySelector('main,.page')),
            structuralPending: box(content?.querySelector('.page-skeleton')),
            media: box(detail?.querySelector('.detail-gallery-shell') ?? content?.querySelector('img')),
            title: box(detail) ? (detail?.querySelector('h1')?.textContent?.trim() ?? null) : null,
            product: box(detail)
                ? (detail?.textContent?.match(/synthetic-[ab] Synthetic product \d+/u)?.[0] ?? null)
                : null,
            missing: Boolean(content?.textContent?.match(/Product not found|没有找到商品/u)),
            pending: [...document.querySelectorAll('[data-page-pending]')]
                .filter(node => box(node))
                .map(node => node.dataset.pagePending),
            brand: !!box(document.querySelector('.page-readiness-initial .brand-loading')),
            brandName: [...document.querySelectorAll('.brand-loading-name')]
                .filter(node => box(node))
                .map(node => node.textContent.trim()),
            language: document.documentElement.lang,
            localeLabel: [...document.querySelectorAll('.locale-preferences-trigger')]
                .filter(node => box(node))
                .map(node => node.textContent.trim()),
            category: !!box(document.querySelector('.category-page')),
            categoryNavigation: box(
                document.querySelector(
                    innerWidth >= 1024 ? '.desktop-catalog-sidebar' : '.category-navigation-shell',
                ),
            ),
            desktopCategory: !!box(document.querySelector('.desktop-catalog-main')),
            criticalGeometry: Object.fromEntries(
                Object.entries({
                    page: '#storefront-content .page',
                    firstProduct:
                        '.category-page .category-product-list > :first-child, .search-page .product-card-detail-link',
                    searchInput: '.search-header input',
                    servicesHeader: '.business-services-heading',
                    servicesImage: '.business-services-hero-media img',
                    supportContent: '.support-center-content',
                    supportContact: '.support-contact-panel',
                    supportFaq: '.support-faq-card',
                    supportInput: '.support-faq-search input',
                    gallery: '.product-detail-page .detail-gallery-shell',
                    summary: '.product-detail-page .detail-summary',
                    actions: '.product-detail-page .detail-action-bar',
                }).map(([key, selector]) => [key, box(document.querySelector(selector))]),
            ),
        };
    };
    const tick = () => {
        if (stopped) return;
        samples.push(read());
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.addEventListener(
        'click',
        event =>
            events.push({
                at: performance.now(),
                type: 'click',
                trusted: event.isTrusted,
                text: event.target.closest('a,button')?.textContent?.trim().slice(0, 80),
                href: event.target.closest('a')?.getAttribute('href'),
                scrollY: window.scrollY,
                categoryScrollTop:
                    document.querySelector('[data-scroll-restoration-id="category-results"]')?.scrollTop ??
                    null,
            }),
        true,
    );
    window.__continuity = {
        samples,
        events,
        read,
        mark(label) {
            events.push({ at: performance.now(), type: 'mark', label });
        },
        finish() {
            stopped = true;
            return { samples, events };
        },
    };
}
const server = await startSeoFixtureServer(0, options);
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true });
const auxiliaryServers = [];

async function runCase(id, width, fn, { expectedConsoleErrors = [] } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'en-US' });
    await context.addInitScript(observeFrames);
    const page = await context.newPage();
    const errors = [];
    const expectedErrors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            const text = message.text();
            if (expectedConsoleErrors.some(pattern => text.includes(pattern)))
                expectedErrors.push({ text, url: message.location().url });
            else errors.push(text);
        }
    });
    page.on('request', request => {
        if (/shop-api|page-data/u.test(request.url()))
            requests.push({ url: request.url(), method: request.method(), body: request.postData() });
    });
    await page.route('**/*', route =>
        /^(127\.0\.0\.1|localhost)$/u.test(new URL(route.request().url()).hostname)
            ? route.continue()
            : route.abort('blockedbyclient'),
    );
    await page.route('**/qa/services-*.svg', route => {
        const mobile = route.request().url().includes('mobile');
        return route.fulfill({
            contentType: 'image/svg+xml',
            body:
                `<svg xmlns="http://www.w3.org/2000/svg" width="${mobile ? 1000 : 2000}" height="${mobile ? 1000 : 800}">` +
                '<rect width="100%" height="100%" fill="#d5dee4"/></svg>',
        });
    });
    let detail = {};
    try {
        detail = await fn(page, context);
        assert.deepEqual(errors, [], 'Browser must not emit runtime or console errors');
        checks.push({ id, width, ...detail });
    } catch (error) {
        failures.push({ id, width, message: error.message, errors, ...detail });
        await page.screenshot({ path: path.join(output, id + '-failure.png') }).catch(() => undefined);
    } finally {
        const timeline = await page.evaluate(() => window.__continuity?.finish()).catch(() => null);
        await writeFile(
            path.join(output, id + '.json'),
            JSON.stringify({ id, width, errors, expectedErrors, requests, detail, timeline }, null, 2),
        );
        await context.close();
    }
}
async function ready(page) {
    await expect(page.locator('#root')).toHaveAttribute('data-public-adopted', '1', { timeout: 30000 });
    await expect(page.locator('[data-page-readiness=ready]')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-storefront-theme-pending'));
    await page.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
}
async function mark(page, label) {
    await page.evaluate(value => window.__continuity.mark(value), label);
}
async function readSince(page, label) {
    return page.evaluate(value => {
        const at = window.__continuity.events.find(event => event.label === value)?.at ?? 0;
        return window.__continuity.samples.filter(sample => sample.at >= at);
    }, label);
}
async function delayedProduct(page, id, delay) {
    const pending = [];
    await page.route('**/_storefront/page-data?**', async route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('kind') !== 'product' || url.searchParams.get('id') !== id)
            return route.fallback();
        const task = (async () => {
            await mark(page, `request:${id}`).catch(() => undefined);
            const response = await route.fetch();
            await new Promise(resolve => setTimeout(resolve, delay));
            await mark(page, `release:${id}`).catch(() => undefined);
            await route.fulfill({ response }).catch(() => undefined);
        })();
        pending.push(task);
        await task;
    });
    return () => Promise.allSettled(pending);
}

try {
    if (selected.has('hydration'))
        for (const width of widths)
            for (const kind of hydrationKinds) {
                await runCase(`hydrate-${kind}-${width}`, width, async page => {
                    const url =
                        origin +
                        (kind === 'catalog'
                            ? '/en/category?collectionId=synthetic-a-collection'
                            : kind === 'search'
                              ? '/en/search?term=product+1'
                              : kind === 'services'
                                ? '/en/services'
                                : kind === 'support'
                                  ? '/en/support'
                                  : '/en/product?id=synthetic-a-product-1');
                    const html = await (await fetch(url)).text();
                    const entry = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/gu)]
                        .map(match => match[1])
                        .find(src => src === '/src/main.tsx' || /\/assets\/index-[^/]+\.js$/u.test(src));
                    assert.ok(entry, 'The actual main bundle must be found');
                    let release;
                    const barrier = new Promise(resolve => (release = resolve));
                    await page.route(origin + entry, async route => {
                        await barrier;
                        await route.continue();
                    });
                    try {
                        await page.goto(url, { waitUntil: 'commit' });
                        await page.waitForSelector('#storefront-content .page', { state: 'attached' });
                        if (kind === 'services')
                            await page.waitForFunction(() => {
                                const image = document.querySelector('.business-services-hero-media img');
                                return image?.complete && image.naturalWidth > 0;
                            });
                        await page.evaluate(
                            () =>
                                new Promise(resolve =>
                                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                                ),
                        );
                        const before = await page.evaluate(() => {
                            window.__pageNode = document.querySelector('#storefront-content .page');
                            window.__criticalNodes = Object.fromEntries(
                                Object.entries({
                                    page: '#storefront-content .page',
                                    firstProduct:
                                        '.category-page .product-card-detail-link, .search-page .product-card-detail-link',
                                    searchInput: '.search-header input',
                                    servicesHeader: '.business-services-heading',
                                    servicesImage: '.business-services-hero-media img',
                                    supportContent: '.support-center-content',
                                    supportContact: '.support-contact-panel',
                                    supportFaq: '.support-faq-card',
                                    supportInput: '.support-faq-search input',
                                    gallery: '.product-detail-page .detail-gallery-shell',
                                    summary: '.product-detail-page .detail-summary',
                                    actions: '.product-detail-page .detail-action-bar',
                                })
                                    .map(([key, selector]) => [key, document.querySelector(selector)])
                                    .filter(([, node]) => node),
                            );
                            return {
                                ...window.__continuity.read(),
                                servicesImageSrc: document.querySelector('.business-services-hero-media img')
                                    ?.currentSrc,
                            };
                        });
                        await page.screenshot({
                            path: path.join(output, `hydrate-${kind}-${width}-before.png`),
                        });
                        await mark(page, 'hydrate');
                        release();
                        await ready(page);
                        const after = await page.evaluate(() => ({
                            ...window.__continuity.read(),
                            originalPageRetained: window.__pageNode?.isConnected,
                            servicesImageSrc: document.querySelector('.business-services-hero-media img')
                                ?.currentSrc,
                            retained: Object.fromEntries(
                                Object.entries(window.__criticalNodes).map(([key, node]) => [
                                    key,
                                    node.isConnected,
                                ]),
                            ),
                        }));
                        await page.screenshot({
                            path: path.join(output, `hydrate-${kind}-${width}-after.png`),
                        });
                        const frames = await readSince(page, 'hydrate');
                        const result = { before, after, frameCount: frames.length };
                        // Record diagnostics before assertions so a failed baseline is independently reviewable.
                        await writeFile(
                            path.join(output, `hydrate-${kind}-${width}-geometry.json`),
                            JSON.stringify(result, null, 2),
                        );
                        for (const key of kind === 'services'
                            ? ['servicesHeader', 'servicesImage']
                            : kind === 'support'
                              ? ['supportContent', 'supportContact', 'supportFaq', 'supportInput']
                              : kind !== 'product'
                                ? ['firstProduct', ...(kind === 'search' ? ['searchInput'] : [])]
                                : ['gallery', 'summary', 'actions'])
                            assert.ok(
                                before.criticalGeometry[key] && after.criticalGeometry[key],
                                `Actual ${key} DOM must exist in both SSR and adopted content`,
                            );
                        if (kind === 'services')
                            assert.equal(
                                after.servicesImageSrc,
                                before.servicesImageSrc,
                                'Services changed its responsive image during adoption',
                            );
                        assert.equal(
                            after.originalPageRetained,
                            true,
                            'Hydration replaced the first page component',
                        );
                        assert.equal(
                            frames.some(frame => frame.brand || !frame.content),
                            false,
                            'Hydration hid previously available content',
                        );
                        assert.ok(
                            Math.abs(before.content[1] - after.content[1]) <= 2,
                            'Content origin shifted by more than 2 CSS px',
                        );
                        for (const [key, retained] of Object.entries(after.retained))
                            assert.equal(retained, true, `${key} DOM node was replaced at hydration`);
                        for (const [key, initial] of Object.entries(before.criticalGeometry)) {
                            if (!initial) continue;
                            const final = after.criticalGeometry[key];
                            assert.ok(final, `${key} disappeared at hydration`);
                            const dimensions = key === 'page' ? 3 : 4;
                            assert.ok(
                                initial
                                    .slice(0, dimensions)
                                    .every((value, index) => Math.abs(value - final[index]) <= 2),
                                `${key} geometry shifted: ${JSON.stringify(initial)} → ${JSON.stringify(final)}`,
                            );
                        }
                        return result;
                    } finally {
                        release();
                    }
                });
            }
    if (selected.has('default-category'))
        for (const width of widths) {
            await runCase(`default-category-${width}`, width, async page => {
                await page.route('**/_storefront/page-data?**', async route => {
                    const url = new URL(route.request().url());
                    if (url.searchParams.get('kind') !== 'catalog') return route.fallback();
                    const input = JSON.parse(url.searchParams.get('input') ?? '{}');
                    if (!input.collectionId) return route.fallback();
                    const response = await route.fetch();
                    await new Promise(resolve => setTimeout(resolve, 650));
                    await route.fulfill({ response }).catch(() => undefined);
                });
                await page.goto(origin + '/en/category', { waitUntil: 'commit' });
                await ready(page);
                await expect(page).toHaveURL(/collectionId=synthetic-a-collection/u);
                await page.waitForTimeout(500);
                const frames = await page.evaluate(() => window.__continuity.samples);
                const first = frames.findIndex(frame => frame.category);
                assert.ok(first >= 0, 'The server category frame must be visible');
                const visible = frames.slice(first);
                assert.equal(
                    visible.some(frame => frame.brand),
                    false,
                    'Default category normalization replayed the brand',
                );
                assert.ok(
                    visible.every(frame => frame.page || frame.structuralPending),
                    'Default category normalization blanked the visible frame',
                );
                assert.ok(
                    visible.every(frame => frame.categoryNavigation),
                    'Default category normalization replaced the existing category navigation',
                );
                const cards = visible.map(frame => frame.criticalGeometry.firstProduct).filter(Boolean);
                assert.ok(cards.length > 0, 'The category must reserve an actual responsive card slot');
                assert.ok(
                    cards.every(rect => rect.every((value, index) => Math.abs(value - cards[0][index]) <= 2)),
                    'The first responsive category card shifted or resized when its skeleton filled',
                );
                return { frameCount: visible.length, canonicalUrl: page.url() };
            });
        }
    if (selected.has('navigation'))
        for (const width of widths.filter(value => value === 390 || value === 1440))
            for (const delay of [180, 220]) {
                await runCase(`product-identity-${width}-${delay}`, width, async page => {
                    await page.goto(origin + '/en/product?id=synthetic-a-product-1');
                    await ready(page);
                    const settle = await delayedProduct(page, 'synthetic-a-product-2', delay);
                    const link = page.locator('a[href="/en/product?id=synthetic-a-product-2"]').first();
                    await expect(link).toBeVisible();
                    await mark(page, 'navigate');
                    await link.click({ noWaitAfter: true });
                    await expect(page).toHaveURL(/id=synthetic-a-product-2/u);
                    await expect(page.locator('.product-detail-page')).toContainText(
                        'synthetic-a Synthetic product 2',
                    );
                    await settle();
                    await page.evaluate(
                        () =>
                            new Promise(resolve =>
                                requestAnimationFrame(() => requestAnimationFrame(resolve)),
                            ),
                    );
                    const frames = await readSince(page, 'navigate');
                    assert.equal(
                        frames.some(frame => frame.missing),
                        false,
                        'Same-route parameter navigation flashed a missing product',
                    );
                    assert.equal(
                        frames.some(frame => frame.brand),
                        false,
                        'Same-store navigation replayed the initial brand',
                    );
                    return {
                        delay,
                        frameCount: frames.length,
                        products: [...new Set(frames.map(frame => frame.product))],
                        pendingFrames: frames.filter(frame => frame.pending.length).length,
                    };
                });
            }
    if (selected.has('race'))
        for (const width of widths.filter(value => value === 390 || value === 1440)) {
            await runCase(`product-race-${width}`, width, async page => {
                await page.goto(origin + '/en/product?id=synthetic-a-product-1');
                await ready(page);
                const settle = await delayedProduct(page, 'synthetic-a-product-2', 650);
                const linkB = page.locator('a[href="/en/product?id=synthetic-a-product-2"]').first();
                await expect(linkB).toBeVisible();
                await mark(page, 'race');
                await linkB.click({ noWaitAfter: true });
                const linkC = page.locator('a[href="/en/product?id=synthetic-a-product-3"]').first();
                await expect(linkC).toBeVisible();
                await linkC.click({ noWaitAfter: true });
                await expect(page).toHaveURL(/id=synthetic-a-product-3/u);
                await expect(page.locator('.product-detail-page')).toContainText(
                    'synthetic-a Synthetic product 3',
                );
                await settle();
                await page.evaluate(
                    () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
                );
                await expect(page).toHaveURL(/id=synthetic-a-product-3/u);
                const frames = await readSince(page, 'race');
                const firstC = frames.findIndex(frame => frame.product === 'synthetic-a Synthetic product 3');
                assert.ok(firstC >= 0, 'C must become visible');
                assert.equal(
                    frames.slice(firstC).some(frame => frame.product === 'synthetic-a Synthetic product 2'),
                    false,
                    'A late B response replaced C',
                );
                assert.equal(
                    frames.some(frame => frame.missing),
                    false,
                    'Race flashed a false missing-product state',
                );
                return {
                    lateResponse: 'B delayed 650ms',
                    frameCount: frames.length,
                    products: [...new Set(frames.map(frame => frame.product))],
                };
            });
        }
    if (selected.has('actions'))
        for (const width of widths.filter(value => value === 390 || value === 1440))
            for (const actionAfter of [100, 260]) {
                await runCase(`product-action-${width}-${actionAfter}`, width, async page => {
                    await page.goto(origin + '/en/product?id=synthetic-a-product-1');
                    await ready(page);
                    const settle = await delayedProduct(page, 'synthetic-a-product-2', 650);
                    await mark(page, 'action-navigation');
                    await page
                        .locator('a[href="/en/product?id=synthetic-a-product-2"]')
                        .first()
                        .click({ noWaitAfter: true });
                    await page.waitForTimeout(actionAfter);
                    await page.evaluate(() => window.scrollTo(0, 0));
                    const atAction = await page.evaluate(() => window.__continuity.read());
                    const favorite = page.locator('.detail-favorite-action');
                    const available = await favorite.isVisible();
                    if (available) {
                        assert.equal(
                            atAction.product,
                            'synthetic-a Synthetic product 1',
                            'An unresolved destination must not borrow a product-list summary',
                        );
                        await mark(page, 'favorite-old-page');
                        await favorite.click({ noWaitAfter: true });
                        await page.waitForFunction(() =>
                            Object.entries(localStorage).some(
                                ([key, value]) =>
                                    key.startsWith('storefront-guest-favorite-product-ids') &&
                                    value.includes('synthetic-a-product-1'),
                            ),
                        );
                    } else
                        assert.ok(
                            atAction.pending.length > 0,
                            'If the old action is gone, the destination must show a structural pending state',
                        );
                    await expect(page).toHaveURL(/id=synthetic-a-product-2/u);
                    await expect(page.locator('.product-detail-page')).toContainText(
                        'synthetic-a Synthetic product 2',
                    );
                    await settle();
                    const favorites = await page.evaluate(() =>
                        Object.fromEntries(
                            Object.entries(localStorage).filter(([key]) =>
                                key.startsWith('storefront-guest-favorite-product-ids'),
                            ),
                        ),
                    );
                    assert.equal(
                        Object.values(favorites).some(value => value.includes('synthetic-a-product-2')),
                        false,
                        'The old-page action changed the destination product',
                    );
                    await expect(page.locator('.detail-favorite-action')).toHaveAttribute(
                        'aria-pressed',
                        'false',
                    );
                    const frames = await readSince(page, 'action-navigation');
                    assert.equal(
                        frames.some(frame => frame.missing || frame.brand),
                        false,
                        'Pending action sequence showed a false empty state or initial brand',
                    );
                    return {
                        delay: 650,
                        actionAfter,
                        atAction,
                        oldActionAvailable: available,
                        favorites,
                        frameCount: frames.length,
                    };
                });
            }
    if (selected.has('departure'))
        for (const width of widths.filter(value => value === 390 || value === 1440)) {
            await runCase(`product-departure-${width}`, width, async page => {
                await page.goto(origin + '/en/');
                await ready(page);
                await page.locator('a[href="/en/product?id=synthetic-a-product-1"]').first().click();
                await expect(page.locator('.product-detail-page')).toBeVisible();
                await ready(page);
                // Use an actual back/home control so its navigation semantics are exercised.
                await mark(page, 'leave-product');
                await page
                    .locator(width < 1024 ? '.product-detail-page .page-back-button' : '.proto-brand')
                    .first()
                    .click();
                await expect(page).toHaveURL(/\/en\/$/u);
                await expect(page.locator('.home-page')).toBeVisible();
                await ready(page);
                const frames = await readSince(page, 'leave-product');
                assert.equal(
                    frames.some(frame => frame.missing),
                    false,
                    'Leaving a product flashed Product not found',
                );
                assert.equal(
                    frames.some(frame => frame.brand || !frame.content),
                    false,
                    'Leaving a product blanked the content or replayed the initial brand',
                );
                return { frameCount: frames.length };
            });
        }
    if (selected.has('cold'))
        for (const width of widths.filter(value => value === 390 || value === 1440)) {
            await runCase(`cold-refresh-${width}`, width, async (page, context) => {
                const cdp = await context.newCDPSession(page);
                await cdp.send('Network.enable');
                await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
                await cdp.send('Network.emulateNetworkConditions', {
                    offline: false,
                    latency: 120,
                    downloadThroughput: 300_000,
                    uploadThroughput: 150_000,
                });
                await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
                await page.goto(origin + '/en/product?id=synthetic-a-product-1', { waitUntil: 'commit' });
                await ready(page);
                const first = await page.evaluate(() => window.__continuity.finish());
                await writeFile(
                    path.join(output, `cold-refresh-${width}-initial.json`),
                    JSON.stringify(first, null, 2),
                );
                await page.reload({ waitUntil: 'commit' });
                await ready(page);
                const refresh = await page.evaluate(() => ({
                    samples: window.__continuity.samples,
                    type: performance.getEntriesByType('navigation')[0]?.type,
                }));
                assert.equal(refresh.type, 'reload');
                for (const [label, samples] of [
                    ['cold', first.samples],
                    ['refresh', refresh.samples],
                ]) {
                    const index = samples.findIndex(
                        frame => frame.product === 'synthetic-a Synthetic product 1' && frame.content,
                    );
                    assert.ok(index >= 0, `${label}: public product never became available`);
                    assert.equal(
                        samples.slice(index).some(frame => frame.brand || !frame.content || frame.missing),
                        false,
                        `${label}: SSR content was hidden or replaced with initial loading`,
                    );
                }
                await page.screenshot({ path: path.join(output, `cold-refresh-${width}-ready.png`) });
                return {
                    network: {
                        latencyMs: 120,
                        downloadBytesPerSecond: 300_000,
                        uploadBytesPerSecond: 150_000,
                        cpuSlowdown: 4,
                        cacheDisabled: true,
                    },
                    coldFrames: first.samples.length,
                    refreshFrames: refresh.samples.length,
                };
            });
        }
    if (selected.has('scope')) {
        // A third synthetic channel uses its own local origin and the same actual renderer.
        const third = await startSeoFixtureServer(0, {
            ...options,
            transformPage(page, metadata) {
                transformPage(page, metadata);
                Object.assign(
                    page,
                    JSON.parse(JSON.stringify(page).replaceAll('synthetic-a', 'synthetic-c')),
                );
            },
        });
        auxiliaryServers.push(third);
        for (const [store, storeOrigin, width] of [
            ['synthetic-a', origin, 390],
            ['synthetic-b', origin.replace('127.0.0.1', 'localhost'), 1440],
            ['synthetic-c', `http://127.0.0.1:${third.port}`, 390],
        ]) {
            await runCase(`scope-language-currency-${store}`, width, async page => {
                await page.goto(storeOrigin + '/en/');
                await ready(page);
                await mark(page, 'scope-changes');
                for (const [language, label, save] of [
                    ['zh', 'ZH', 'Save preferences'],
                    ['en', '英文', '保存设置'],
                ]) {
                    await page.locator('.locale-preferences-trigger:visible').first().click();
                    await page.getByRole('radio', { name: label, exact: true }).click();
                    await page.getByRole('button', { name: save, exact: true }).click();
                    await expect(page).toHaveURL(new RegExp('/' + language + '/$', 'u'));
                    await ready(page);
                    await expect(page.locator('html')).toHaveAttribute(
                        'lang',
                        language === 'zh' ? 'zh-CN' : 'en',
                    );
                    await expect(page.locator('.home-page')).toContainText(store);
                }
                await page.locator('.locale-preferences-trigger:visible').first().click();
                await page.getByRole('radio', { name: 'USDT', exact: false }).click();
                await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
                await expect(page.locator('.locale-preferences-trigger:visible').first()).toContainText(
                    'USDT',
                );
                await ready(page);
                const frames = await readSince(page, 'scope-changes');
                assert.equal(
                    frames.some(frame => frame.brand),
                    false,
                    'Same-store language/currency change replayed the initial brand',
                );
                const text = await page.locator('#storefront-content').innerText();
                for (const other of ['synthetic-a', 'synthetic-b', 'synthetic-c'].filter(
                    value => value !== store,
                ))
                    assert.equal(
                        text.includes(other),
                        false,
                        'Another synthetic channel leaked into this page',
                    );
                const storage = await page.evaluate(() =>
                    Object.keys(localStorage).concat(Object.keys(sessionStorage)),
                );
                return {
                    store,
                    origin: storeOrigin,
                    languageSequence: ['en', 'zh', 'en'],
                    currency: 'USDT display / MYR settlement; no order or payment',
                    frameCount: frames.length,
                    storageKeys: storage,
                };
            });
        }
    }
    if (selected.has('errors'))
        for (const mode of ['request', 'offline', 'timeout']) {
            await runCase(
                `product-error-${mode}`,
                390,
                async (page, context) => {
                    await page.goto(origin + '/en/product?id=synthetic-a-product-1');
                    await ready(page);
                    let recover = false;
                    let release;
                    const barrier = new Promise(resolve => (release = resolve));
                    if (mode !== 'offline')
                        await page.route('**/_storefront/page-data?**', async route => {
                            const url = new URL(route.request().url());
                            if (
                                url.searchParams.get('kind') !== 'product' ||
                                url.searchParams.get('id') !== 'synthetic-a-product-2' ||
                                recover
                            )
                                return route.fallback();
                            if (mode === 'request')
                                return route.fulfill({
                                    status: 503,
                                    contentType: 'application/json',
                                    body: JSON.stringify({ error: 'Synthetic unavailable' }),
                                });
                            await barrier;
                            await route.continue().catch(() => undefined);
                        });
                    if (mode === 'offline') await context.setOffline(true);
                    try {
                        await mark(page, 'critical-failure');
                        await page
                            .locator('a[href="/en/product?id=synthetic-a-product-2"]')
                            .first()
                            .click({ noWaitAfter: true });
                        const error = page
                            .locator('.page-readiness-error,.empty-state')
                            .filter({
                                hasText:
                                    mode === 'offline'
                                        ? /offline|network|网络|离线/iu
                                        : mode === 'request'
                                          ? /could not be loaded|无法加载/iu
                                          : /too long|超时/iu,
                            })
                            .first();
                        await expect(error).toBeVisible({ timeout: mode === 'timeout' ? 15_000 : 10_000 });
                        const message = await error.innerText();
                        await page.screenshot({ path: path.join(output, `product-error-${mode}.png`) });
                        const frames = await readSince(page, 'critical-failure');
                        assert.equal(
                            frames.some(frame => frame.missing || frame.brand),
                            false,
                            'Read failure was presented as missing product or initial brand',
                        );
                        recover = true;
                        await error
                            .getByRole('button', { name: /Try again|Retry|重新尝试|重试/iu })
                            .click({ noWaitAfter: true });
                        release();
                        if (mode === 'offline') await context.setOffline(false);
                        await expect(page.locator('.product-detail-page')).toContainText(
                            'synthetic-a Synthetic product 2',
                            { timeout: 15_000 },
                        );
                        await ready(page);
                        return { mode, message, recovered: true, frameCount: frames.length };
                    } catch (error) {
                        await page.screenshot({
                            path: path.join(output, `product-error-${mode}-before-cleanup.png`),
                        });
                        await writeFile(
                            path.join(output, `product-error-${mode}-before-cleanup.html`),
                            await page.content(),
                        );
                        throw error;
                    } finally {
                        recover = true;
                        release();
                        await context.setOffline(false);
                    }
                },
                {
                    expectedConsoleErrors:
                        mode === 'request'
                            ? ['the server responded with a status of 503']
                            : mode === 'offline'
                              ? ['net::ERR_INTERNET_DISCONNECTED']
                              : [],
                },
            );
        }
    if (selected.has('filter'))
        for (const width of widths.filter(value => value === 390 || value === 1440)) {
            await runCase(`catalog-filter-history-${width}`, width, async page => {
                await page.goto(origin + '/en/category?collectionId=synthetic-a-collection');
                await ready(page);
                const catalogReads = [];
                page.on('request', request => {
                    const url = new URL(request.url());
                    if (
                        url.pathname === '/_storefront/page-data' &&
                        url.searchParams.get('kind') === 'catalog'
                    )
                        catalogReads.push(JSON.parse(url.searchParams.get('input')));
                });
                await mark(page, 'filter');
                await page
                    .locator('.category-page button:visible')
                    .filter({ hasText: /^Newest$/u })
                    .click();
                await expect(page).toHaveURL(/sort=newest/u);
                await expect(
                    page.locator('.category-page button:visible').filter({ hasText: /^Newest$/u }),
                ).toHaveAttribute('aria-pressed', 'true');
                await ready(page);
                const categoryUrl = page.url();
                await page.locator('.category-page .product-card-detail-link').first().click();
                await expect(page.locator('.product-detail-page')).toBeVisible();
                await ready(page);
                await page.goBack();
                await expect(page).toHaveURL(categoryUrl);
                await expect(page.locator('.category-page')).toBeVisible();
                await ready(page);
                await expect(
                    page.locator('.category-page button:visible').filter({ hasText: /^Newest$/u }),
                ).toHaveAttribute('aria-pressed', 'true');
                assert.ok(
                    catalogReads.some(input => input.sort !== 'RECOMMENDED'),
                    'Same-route sort change did not read its target catalog key',
                );
                const frames = await readSince(page, 'filter');
                assert.equal(
                    frames.some(frame => frame.brand || frame.missing),
                    false,
                    'Filter/history replayed initial brand or false product-not-found',
                );
                return { catalogReads, restoredUrl: categoryUrl, frameCount: frames.length };
            });
        }
    if (selected.has('scroll'))
        for (const width of widths.filter(value => value === 390 || value === 1440)) {
            await runCase(`catalog-scroll-history-${width}`, width, async page => {
                await page.setViewportSize({ width, height: 560 });
                await page.goto(origin + '/en/category?collectionId=synthetic-a-collection');
                await ready(page);
                const categoryUrl = page.url();
                await page.mouse.move(Math.round(width * 0.65), 400);
                await page.mouse.wheel(0, width === 1440 ? 420 : 320);
                await expect
                    .poll(() =>
                        page.evaluate(() => {
                            const state = window.__continuity.read();
                            return state.scrollY + (state.categoryScrollTop ?? 0);
                        }),
                    )
                    .toBeGreaterThan(100);
                await page.waitForTimeout(150);
                const target = await page
                    .locator('.category-page .product-card-detail-link')
                    .evaluateAll(nodes => {
                        for (const node of nodes) {
                            // The title is the actual click target. A tall card need not fit
                            // completely in this short viewport to have a stable visible link.
                            const box = node.querySelector('.product-card-name')?.getBoundingClientRect();
                            if (!box || box.top <= 80 || box.bottom >= window.innerHeight - 60) continue;
                            const x = box.x + box.width / 2;
                            const y = box.y + box.height / 2;
                            if (document.elementFromPoint(x, y)?.closest('a') !== node) continue;
                            return { href: node.getAttribute('href'), x, y };
                        }
                        return null;
                    });
                assert.ok(target, 'A fully visible product title is required to avoid click auto-scrolling');
                await mark(page, 'scroll-departure');
                await page.mouse.click(target.x, target.y);
                const departure = await page.evaluate(
                    href =>
                        window.__continuity.events.findLast(
                            event => event.type === 'click' && event.href === href,
                        ),
                    target.href,
                );
                assert.ok(departure?.trusted);
                assert.ok(departure.scrollY + (departure.categoryScrollTop ?? 0) > 100);
                await expect(page.locator('.product-detail-page')).toBeVisible();
                await ready(page);
                await mark(page, 'browser-back');
                await page.goBack();
                await expect(page).toHaveURL(categoryUrl);
                await expect(page.locator('.category-page')).toBeVisible();
                await ready(page);
                await mark(page, 'back-ready');
                const restored = await page.evaluate(() => window.__continuity.read());
                await page.waitForTimeout(500);
                const settledFrames = await readSince(page, 'back-ready');
                const returnFrames = await readSince(page, 'browser-back');
                const result = {
                    viewport: { width, height: 560 },
                    departure,
                    restored,
                    scrollOwner: departure.scrollY > 100 ? 'window' : 'category-results',
                    restoredWindowY: restored.scrollY,
                    restoredCategoryScrollTop: restored.categoryScrollTop,
                    returnFrameCount: returnFrames.length,
                    settledFrameCount: settledFrames.length,
                };
                await writeFile(
                    path.join(output, `catalog-scroll-history-${width}-geometry.json`),
                    JSON.stringify(result, null, 2),
                );
                await page.screenshot({ path: path.join(output, `catalog-scroll-history-${width}.png`) });
                assert.ok(
                    Math.abs(restored.scrollY - departure.scrollY) <= 2,
                    'Window scroll was not restored',
                );
                assert.ok(
                    Math.abs((restored.categoryScrollTop ?? 0) - (departure.categoryScrollTop ?? 0)) <= 2,
                    'Category scroll owner was not restored',
                );
                assert.ok(settledFrames.length > 5);
                assert.equal(
                    settledFrames.some(
                        frame =>
                            Math.abs(frame.scrollY - restored.scrollY) > 2 ||
                            Math.abs((frame.categoryScrollTop ?? 0) - (restored.categoryScrollTop ?? 0)) > 2,
                    ),
                    false,
                    'Scroll jumped again after the returned page became ready',
                );
                assert.equal(
                    returnFrames.some(frame => frame.brand || frame.missing),
                    false,
                );
                return result;
            });
        }
    if (selected.has('currency'))
        await runCase('settlement-currency-scope', 1440, async page => {
            await page.goto(origin + '/en/product?id=synthetic-a-product-1');
            await ready(page);
            const original = await page.locator('.detail-price').innerText();
            const publicReads = [];
            page.on('response', async response => {
                if (new URL(response.url()).pathname === '/_storefront/page-data') {
                    try {
                        const data = await response.json();
                        publicReads.push({
                            scope: data.scope,
                            productId: data.product?.id,
                            price: data.product?.variants?.[0]?.priceWithTax,
                        });
                    } catch {
                        // Failed read bodies are covered by the page's own error assertions.
                    }
                }
            });
            await mark(page, 'settlement-currency');
            const prices = [];
            for (const currency of ['CNY', 'MYR']) {
                await page.locator('.locale-preferences-trigger:visible').first().click();
                await page.getByRole('radio', { name: currency, exact: true }).click();
                await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
                await expect(page.locator('.locale-preferences-trigger:visible').first()).toContainText(
                    currency,
                );
                await expect(page.locator('.detail-price')).toContainText(currency === 'CNY' ? '48' : '24', {
                    timeout: 15_000,
                });
                await ready(page);
                prices.push({ currency, text: await page.locator('.detail-price').innerText() });
            }
            assert.equal(prices[1].text, original, 'Returning to MYR did not restore its own price');
            assert.ok(
                publicReads.some(read => read.scope.currencyCode === 'CNY' && read.price === 4800),
                'CNY detail must be fetched from its own scoped public query',
            );
            assert.equal(
                (await readSince(page, 'settlement-currency')).some(frame => frame.brand),
                false,
                'Settlement-currency switch replayed the initial brand',
            );
            return {
                sequence: ['MYR', 'CNY', 'MYR'],
                original,
                prices,
                publicReads,
                checkoutOrder: null,
                syntheticPriceRule: 'CNY fixture prices are twice MYR solely to expose wrong-scope reuse',
            };
        });
    if (selected.has('cart'))
        await runCase('old-product-cart-ownership', 390, async page => {
            let cart = (
                await (
                    await fetch(origin + '/shop-api', {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json',
                            referer: origin + '/en/product?id=synthetic-a-product-1',
                        },
                        body: JSON.stringify({
                            query: 'query StorefrontCart { storefrontCart { id revision } }',
                        }),
                    })
                ).json()
            ).data.storefrontCart;
            const commands = [];
            const productData = await (
                await fetch(
                    origin +
                        '/_storefront/page-data?kind=product&id=synthetic-a-product-1&languageCode=en&currencyCode=MYR',
                )
            ).json();
            const variant = productData.product.variants[0];
            await page.route('**/shop-api**', async route => {
                const operation = route.request().postDataJSON();
                if (operation.query.includes('mutation ApplyStorefrontCartCommand')) {
                    const input = operation.variables.input;
                    commands.push(input);
                    cart = {
                        ...cart,
                        revision: cart.revision + 1,
                        projectedRevision: cart.revision + 1,
                        totalQuantity: 2,
                        selectedQuantity: 2,
                        selectedLineCount: 1,
                        selectionState: 'ALL',
                        subTotalWithTax: variant.priceWithTax * 2,
                        selectedSubTotalWithTax: variant.priceWithTax * 2,
                        lines: [
                            {
                                id: 'synthetic-cart-line-a',
                                quantity: 2,
                                selected: true,
                                available: true,
                                productVariant: variant,
                            },
                        ],
                        checkoutOrder: null,
                    };
                    return route.fulfill({
                        contentType: 'application/json',
                        body: JSON.stringify({
                            data: {
                                applyStorefrontCartCommand: {
                                    commandId: input.commandId,
                                    status: 'APPLIED',
                                    appliedRevision: cart.revision,
                                    errorCode: null,
                                    message: null,
                                    cart: { id: cart.id, revision: cart.revision },
                                    session: null,
                                },
                            },
                        }),
                    });
                }
                if (operation.query.includes('query StorefrontCart')) {
                    if (!cart) {
                        const response = await route.fetch();
                        cart = (await response.json()).data.storefrontCart;
                    }
                    return route.fulfill({
                        contentType: 'application/json',
                        body: JSON.stringify({ data: { storefrontCart: cart } }),
                    });
                }
                return route.fallback();
            });
            await page.goto(origin + '/en/product?id=synthetic-a-product-1');
            await ready(page);
            await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
            await expect(page.locator('.detail-quantity output')).toHaveText('2');
            const settle = await delayedProduct(page, 'synthetic-a-product-2', 650);
            await mark(page, 'cart-navigation');
            await page
                .locator('a[href="/en/product?id=synthetic-a-product-2"]')
                .first()
                .click({ noWaitAfter: true });
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(50);
            assert.equal(
                (await page.evaluate(() => window.__continuity.read())).product,
                'synthetic-a Synthetic product 1',
            );
            await page.getByRole('button', { name: 'Add to cart', exact: true }).click({ noWaitAfter: true });
            await expect.poll(() => commands.length).toBe(1);
            assert.deepEqual(
                commands[0].changes.add,
                [{ productVariantId: variant.id, quantity: 2 }],
                'Old visible product must own variant and quantity',
            );
            await expect(page.locator('.product-detail-page')).toContainText(
                'synthetic-a Synthetic product 2',
            );
            await settle();
            const timing = await page.evaluate(() => {
                const events = window.__continuity.events;
                const navigation = events.find(
                    event => event.type === 'click' && event.href === '/en/product?id=synthetic-a-product-2',
                );
                const add = events.find(event => event.type === 'click' && event.text === 'Add to cart');
                return { navigation, add, elapsed: add?.at - navigation?.at };
            });
            assert.ok(
                timing.add.trusted && timing.navigation.trusted && timing.elapsed < 200,
                'The actual cart click must occur before the Router pending threshold',
            );
            await expect(page.locator('.detail-action-bar button[aria-label^="Cart"]')).toHaveAttribute(
                'aria-label',
                /2/u,
            );
            await page.locator('.detail-action-bar button[aria-label^="Cart"]').click();
            await expect(page.locator('#storefront-content')).toContainText(
                'synthetic-a Synthetic product 1',
            );
            assert.equal(cart.checkoutOrder, null);
            return {
                commands,
                cart,
                timing,
                allWrites: 'Intercepted in Playwright and fulfilled locally; no backend mutation or order',
            };
        });
    if (selected.has('search'))
        for (const width of widths.filter(value => value === 390 || value === 1440)) {
            await runCase(`search-keyboard-filter-history-${width}`, width, async page => {
                await page.goto(origin + '/en/search?term=product+1');
                await ready(page);
                await expect(page.locator('.search-page')).toBeVisible();
                const input = page.locator('.search-page input[type="search"]');
                await expect(input).toHaveValue('product 1');
                await mark(page, 'search-keyboard');
                await input.fill('product 2');
                await input.press('ArrowDown');
                await input.press('Enter');
                await expect(page).toHaveURL(/term=product(?:\+|%20)2/u);
                await ready(page);
                await expect(page.locator('.search-results')).toContainText(
                    'synthetic-a Synthetic product 2',
                );
                await page
                    .locator('.search-sort button')
                    .filter({ hasText: /^Price/u })
                    .click();
                await expect(page).toHaveURL(/sort=price-asc/u);
                await ready(page);
                const searchUrl = page.url();
                await page.locator('.search-page .product-card-detail-link').first().click();
                await expect(page.locator('.product-detail-page')).toBeVisible();
                await ready(page);
                await page.goBack();
                await expect(page).toHaveURL(searchUrl);
                await expect(page.locator('.search-page')).toBeVisible();
                await ready(page);
                await expect(input).toHaveValue('product 2');
                await expect(
                    page.locator('.search-sort button').filter({ hasText: /^Price/u }),
                ).toHaveAttribute('aria-pressed', 'true');
                assert.equal(
                    (await readSince(page, 'search-keyboard')).some(frame => frame.brand || frame.missing),
                    false,
                    'Search keyboard/filter/history replayed brand or false missing product',
                );
                await page.screenshot({
                    path: path.join(output, `search-keyboard-filter-history-${width}.png`),
                });
                return {
                    term: 'product 2',
                    sort: 'price-asc',
                    restoredUrl: searchUrl,
                    keyboard: ['ArrowDown', 'Enter'],
                };
            });
        }
} finally {
    await writeFile(
        path.join(output, 'report.json'),
        JSON.stringify(
            {
                synthetic: true,
                harnessSha256: createHash('sha256')
                    .update(await readFile(fileURLToPath(import.meta.url)))
                    .digest('hex'),
                baseline,
                mode: dev ? 'real-source' : 'production-artifact',
                dist: dev ? undefined : dist,
                method: 'requestAnimationFrame observations plus before/after screenshots; DOM/layout evidence, not a claim of physical-display paint timing',
                checks,
                failures,
            },
            null,
            2,
        ),
    );
    await browser.close();
    await server.close();
    for (const auxiliary of auxiliaryServers) await auxiliary.close();
    await vite?.close();
}
process.stdout.write(JSON.stringify({ checks: checks.length, failures: failures.length, output }) + '\n');
if (!baseline) assert.deepEqual(failures, [], 'Loading continuity regression failed; see evidence');
