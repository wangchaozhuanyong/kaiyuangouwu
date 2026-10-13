import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSeoFixtureServer } from './preview-server.mjs';

const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const storefront = path.join(project, 'packages/storefront');
const output = path.resolve(
    project,
    process.env.HYDRATION_QA_OUTPUT ?? 'docs/local-validation/experience-offline-20261013/hydration',
);
assert.ok(output.startsWith(project + path.sep), 'Evidence belongs inside this project');
await mkdir(output, { recursive: true });
const dev = process.argv.includes('--dev');
const smoke = process.argv.includes('--smoke');
const edges = process.argv.includes('--edges');
const accountChunks = new Set(['/src/api/account.ts']);
if (!dev) {
    const assets = path.join(storefront, 'dist/assets');
    for (const file of (await readdir(assets)).filter(candidate => candidate.endsWith('.js')))
        if ((await readFile(path.join(assets, file), 'utf8')).includes('StorefrontCustomerAddresses'))
            accountChunks.add('/assets/' + file);
}
let vite;
if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({
        root: storefront,
        configFile: path.join(storefront, 'vite.config.ts'),
        // Exercise the production domain-resolved mode, not the developer's channel switcher.
        define: { 'import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING': JSON.stringify('false') },
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
    });
}
const server = await startSeoFixtureServer(0, {
    transformPage(page, { url }) {
        const id =
            /\/(support|services|legal)$/u.exec(url.pathname)?.[1] ??
            (url.searchParams.get('kind') === 'page' ? url.searchParams.get('id') : null);
        if (id) {
            const document = id === 'legal' ? (url.searchParams.get('id') ?? 'privacy') : id;
            page.request = { kind: 'page', id: document };
            page.requestKey = JSON.stringify(page.request);
            const prefix = page.scope.languageCode === 'en' ? 'en' : 'zh';
            page.route = `/${prefix}/${id === 'terms' || id === 'privacy' ? 'legal?id=' + id : id}`;
            if (id === 'legal') page.route += '?id=' + document;
            page.seo.requestKey = page.requestKey;
            page.seo.canonical = `http://${page.scope.host}${page.route}`;
        }
        // Include a labelled input so useId tree parity is tested, not just text-only support.
        if (page.request.kind === 'page' && page.request.id === 'support') {
            const block = {
                ...page.content.blocks[0],
                id: 'synthetic-support',
                type: 'SUPPORT',
                title: 'Synthetic support',
                items: [],
                settings: {
                    supportFaqs: [
                        {
                            id: 'synthetic-faq',
                            enabled: true,
                            questionZh: '怎样核款？',
                            questionEn: 'How is payment confirmed?',
                            answerZh: '此处是本地合成内容。',
                            answerEn: 'Synthetic local content only.',
                        },
                    ],
                },
            };
            page.content.blocks.push(block);
        }
        if (url.searchParams.get('qaMissingImage') === '1') {
            const clearImages = product => {
                product.featuredAsset = null;
                product.assets = [];
                product.variants.forEach(variant => {
                    variant.featuredAsset = null;
                    variant.product.featuredAsset = null;
                });
            };
            page.products.forEach(clearImages);
            if (page.product) clearImages(page.product);
            page.collections.forEach(collection => {
                collection.featuredAsset = null;
            });
        }
        if (url.searchParams.get('qaUsdt') === '1')
            page.config.currencyConfiguration = {
                availableCurrencyCodes: ['MYR'],
                selectorEnabled: true,
                usdtDisplayEnabled: true,
                usdtRateAvailable: true,
                usdtPaymentConfigured: true,
                myrPerUsdtRate: 4.5,
                cnyPerUsdtRate: 7,
                usdtMarkupPercent: 0,
            };
        if (url.searchParams.get('qaMissingEntity') === '1') {
            if (page.request.kind === 'product') page.product = null;
            if (page.request.kind === 'article') delete page.publicContent;
        }
        if (url.searchParams.get('qaDefaultCategory') === '1') {
            page.request = {
                kind: 'catalog',
                path: '/category',
                input: {
                    sort: 'RECOMMENDED',
                    inStockOnly: false,
                    skip: 0,
                    take: 12,
                },
            };
            page.requestKey = JSON.stringify(page.request);
            page.catalog.items = page.products;
        }
        if (url.searchParams.get('qaChildCategory') === '1') {
            const child = {
                ...page.collections[0],
                id: 'synthetic-child',
                parentId: page.collections[0].id,
                children: [],
            };
            page.collections[0].children = [child];
            page.request = {
                kind: 'catalog',
                path: '/category',
                input: {
                    collectionId: child.id,
                    sort: 'RECOMMENDED',
                    inStockOnly: false,
                    skip: 0,
                    take: 12,
                },
            };
            page.requestKey = JSON.stringify(page.request);
            page.catalog.items = page.products;
        }
        if (url.searchParams.get('qaSearch') === '1') {
            page.request = {
                kind: 'catalog',
                path: '/search',
                input: {
                    term: 'synthetic',
                    sort: 'RECOMMENDED',
                    inStockOnly: false,
                    skip: 0,
                    take: 12,
                },
            };
            page.requestKey = JSON.stringify(page.request);
            page.catalog = { items: page.products, totalItems: 36 };
        }
        if (url.pathname !== '/_storefront/page-data') page.route = url.pathname + url.search;
    },
    ...(vite
        ? {
              renderPage: async page =>
                  (await vite.ssrLoadModule('/src/entry-public-server.tsx')).renderPublicPage(page),
              transformHtml: async route =>
                  vite.transformIndexHtml(route, await readFile(path.join(storefront, 'index.html'), 'utf8')),
              serveAssets: async (request, response) => {
                  if (!/^\/(?:src\/|@|node_modules\/)/u.test(request.url)) return false;
                  return new Promise((resolve, reject) => {
                      response.once('finish', () => resolve(true));
                      vite.middlewares(request, response, error => (error ? reject(error) : resolve(false)));
                  });
              },
          }
        : {
              // Keep this fixture aligned with StorefrontSeoHtmlService. Production
              // renders these lazy-route styles with the initial public HTML.
              transformHtml: async route => {
                  const dist = path.join(storefront, 'dist');
                  const prefixes = route.includes('/product')
                      ? ['product-detail-page-']
                      : /\/(?:category|search)/u.test(route)
                        ? [
                              'account-catalog-surfaces-',
                              ...(route.includes('/search') ? ['search-loading-', 'search-page-'] : []),
                          ]
                        : [];
                  const emittedAssets = await readdir(path.join(dist, 'assets'));
                  const styles = prefixes.flatMap(prefix =>
                      emittedAssets.filter(file => file.endsWith('.css') && file.startsWith(prefix)),
                  );
                  assert.ok(prefixes.every(prefix => styles.some(file => file.startsWith(prefix))));
                  return (await readFile(path.join(dist, 'index.html'), 'utf8')).replace(
                      '</head>',
                      styles.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('') +
                          '</head>',
                  );
              },
          }),
});
const browser = await chromium.launch({ headless: true });
const checks = [];
const failures = [];
try {
    const cases = edges
        ? [
              { kind: 'home', query: 'qaMissingImage=1', label: 'missing-media' },
              { kind: 'home', query: '', label: 'newer-cache' },
              { kind: 'home', query: 'qaUsdt=1', label: 'usdt-preference' },
              {
                  kind: 'support',
                  query: 'orderCode=SYNTHETIC-ORDER&focus=evaluation',
                  label: 'support-order',
              },
              { kind: 'product', query: 'qaMissingEntity=1', label: 'missing-product' },
              { kind: 'article', query: 'qaMissingEntity=1', label: 'missing-guide' },
              { kind: 'catalog', query: 'qaDefaultCategory=1', label: 'default-category' },
              {
                  kind: 'catalog',
                  query: 'childId=synthetic-child&qaChildCategory=1',
                  label: 'child-category',
              },
              { kind: 'search', query: 'term=synthetic&qaSearch=1', label: 'search-term' },
          ]
        : (smoke ? ['home'] : ['home', 'catalog', 'product', 'article', 'support', 'services', 'legal']).map(
              kind => ({ kind, query: '', label: kind }),
          );
    for (const language of smoke ? ['en'] : ['en', 'zh'])
        for (const width of smoke ? [390] : [390, 1440])
            for (const { kind, query, label } of cases) {
                const store = 'synthetic-a';
                const origin = `http://127.0.0.1:${server.port}`;
                const baseRoute =
                    label === 'default-category' || label === 'child-category'
                        ? `/${language}/category`
                        : `/${language}/` +
                          (kind === 'home'
                              ? ''
                              : kind === 'catalog'
                                ? `category?collectionId=${store}-collection&page=2`
                                : kind === 'product'
                                  ? `product?id=${store}-product-1`
                                  : kind === 'article'
                                    ? `guides/${store}-guide`
                                    : kind === 'legal'
                                      ? 'legal?id=privacy'
                                      : kind);
                const route = baseRoute + (query ? (baseRoute.includes('?') ? '&' : '?') + query : '');
                const id = `${language}-${width}-${label}`;
                const html = await (await fetch(origin + route)).text();
                const entry = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/gu)]
                    .map(match => match[1])
                    .find(src => src === '/src/main.tsx' || /\/assets\/index-[^/]+\.js$/u.test(src));
                assert.ok(entry, `${id}: real main entry must exist`);
                const context = await browser.newContext({
                    viewport: { width, height: 844 },
                    locale: language === 'en' ? 'zh-CN' : 'en-US',
                });
                const page = await context.newPage();
                const errors = [];
                const accountLoads = [];
                page.on('request', request => {
                    if (accountChunks.has(new URL(request.url()).pathname)) accountLoads.push(request.url());
                });
                const errorDetails = [];
                page.on('console', message => {
                    if (message.type() !== 'error') return;
                    errors.push(message.text());
                    errorDetails.push(
                        Promise.all(
                            message.args().map(argument =>
                                argument
                                    .evaluate(value =>
                                        value instanceof Error
                                            ? {
                                                  message: value.message,
                                                  stack: value.stack,
                                                  cause:
                                                      value.cause instanceof Error
                                                          ? {
                                                                message: value.cause.message,
                                                                stack: value.cause.stack,
                                                            }
                                                          : String(value.cause),
                                              }
                                            : String(value),
                                    )
                                    .catch(() => null),
                            ),
                        ),
                    );
                });
                page.on('pageerror', error => errors.push(error.message));
                let releaseEntry;
                const entryReady = new Promise(resolve => {
                    releaseEntry = resolve;
                });
                await page.route(origin + entry, async held => {
                    await entryReady;
                    await held.continue();
                });
                try {
                    await page.goto(origin + route, { waitUntil: 'commit' });
                    await page.waitForSelector('#storefront-content .page', { state: 'attached' });
                    if (label === 'usdt-preference')
                        await page.evaluate(() => {
                            localStorage.setItem('storefront-currency-preference-v1:synthetic-a', 'USDT');
                        });
                    if (label === 'newer-cache')
                        await page.evaluate(() => {
                            const initial = JSON.parse(
                                document.getElementById('storefront-public-page-data').textContent,
                            );
                            const data = structuredClone(initial.content);
                            data.blocks.find(block => block.type === 'FEATURED_COLLECTION').title =
                                'QA newer cache heading';
                            const queryKey = [
                                'storefront',
                                'synthetic-a:MYR',
                                initial.scope.languageCode,
                                'content',
                                'public',
                            ];
                            const now = Date.now();
                            sessionStorage.setItem(
                                'vendure-storefront-public-query-cache:v7',
                                JSON.stringify({
                                    version: 7,
                                    savedAt: now,
                                    state: {
                                        mutations: [],
                                        queries: [
                                            {
                                                queryKey,
                                                queryHash: JSON.stringify(queryKey),
                                                meta: { persistPublic: true },
                                                state: {
                                                    data,
                                                    dataUpdateCount: 1,
                                                    dataUpdatedAt: now,
                                                    error: null,
                                                    errorUpdateCount: 0,
                                                    errorUpdatedAt: 0,
                                                    fetchFailureCount: 0,
                                                    fetchFailureReason: null,
                                                    fetchMeta: null,
                                                    isInvalidated: false,
                                                    status: 'success',
                                                    fetchStatus: 'idle',
                                                },
                                            },
                                        ],
                                    },
                                }),
                            );
                        });
                    await page.evaluate(() => {
                        const root = document.getElementById('root');
                        const content = document.getElementById('storefront-content');
                        window.__hydrationOriginal = {
                            root,
                            content,
                            frame: root.querySelector('.storefront-app'),
                            page: content.querySelector('.page'),
                            image: content.querySelector('img'),
                            navigation: root.querySelector('.storefront-bottom-nav'),
                            removals: [],
                        };
                        window.__hydrationObserver = new MutationObserver(records => {
                            for (const record of records)
                                for (const removed of record.removedNodes)
                                    for (const key of ['content', 'frame', 'page', 'image', 'navigation']) {
                                        const original = window.__hydrationOriginal[key];
                                        if (
                                            original &&
                                            (removed === original || removed.contains?.(original))
                                        )
                                            window.__hydrationOriginal.removals.push(key);
                                    }
                        });
                        window.__hydrationObserver.observe(root, { childList: true, subtree: true });
                    });
                    releaseEntry();
                    await expect(page.locator('[data-page-readiness=ready]')).toBeVisible({
                        timeout: 30_000,
                    });
                    await expect(page.locator('#root')).toHaveAttribute('data-public-adopted', '1');
                    await expect(page.locator('html')).toHaveAttribute(
                        'lang',
                        language === 'en' ? 'en' : 'zh-CN',
                    );
                    // A successful passive commit proves React has finished adopting the anonymous HTML.
                    await page.waitForFunction(
                        () => !document.documentElement.hasAttribute('data-storefront-theme-pending'),
                    );
                    await page.evaluate(
                        () =>
                            new Promise(resolve =>
                                requestAnimationFrame(() => requestAnimationFrame(resolve)),
                            ),
                    );
                    const retention = await page.evaluate(() => {
                        const original = window.__hydrationOriginal;
                        window.__hydrationObserver.disconnect();
                        return {
                            frame: original.frame === document.querySelector('.storefront-app'),
                            content: original.content === document.getElementById('storefront-content'),
                            page: original.page === document.querySelector('#storefront-content .page'),
                            image: !original.image || original.image.isConnected,
                            navigation: !original.navigation || original.navigation.isConnected,
                            removals: original.removals,
                        };
                    });
                    assert.ok(
                        retention.frame && retention.content,
                        `${id}: persistent shell DOM was replaced`,
                    );
                    assert.ok(retention.page, `${id}: first page DOM was replaced`);
                    if (width < 1024)
                        assert.ok(
                            retention.page && retention.image && retention.navigation,
                            `${id}: first page, media or navigation was replaced: ${JSON.stringify(retention)}`,
                        );
                    assert.deepEqual(errors, [], `${id}: hydration/console errors`);
                    assert.deepEqual(
                        accountLoads,
                        [],
                        `${id}: anonymous public entry must not download private account operations`,
                    );
                    if (label === 'newer-cache')
                        await expect(page.locator('#storefront-content')).toContainText(
                            'QA newer cache heading',
                        );
                    if (label === 'usdt-preference')
                        await expect(page.locator('#storefront-content')).toContainText('USDT');
                    if (kind === 'home' && !edges) {
                        await page.evaluate(() => {
                            window.__stableFrame = document.querySelector('.storefront-app');
                            window.__stableContent = document.getElementById('storefront-content');
                        });
                        const link = page
                            .locator(`a[href="/${language}/product?id=${store}-product-1"]`)
                            .first();
                        await link.click();
                        await expect(page).toHaveURL(origin + `/${language}/product?id=${store}-product-1`);
                        await expect(page.locator('.product-detail-page')).toBeVisible();
                        assert.ok(
                            await page.evaluate(
                                () =>
                                    window.__stableFrame === document.querySelector('.storefront-app') &&
                                    window.__stableContent === document.getElementById('storefront-content'),
                            ),
                            `${id}: navigation replaced the shell`,
                        );
                    }
                    checks.push({ id, retention, errors, privateAccountLoads: accountLoads.length });
                } catch (error) {
                    failures.push({
                        id,
                        error: error.message,
                        errors,
                        details: await Promise.all(errorDetails),
                    });
                    await writeFile(path.join(output, `${id}-failure.html`), await page.content());
                    await page.screenshot({ path: path.join(output, `${id}-failure.png`), fullPage: false });
                    throw error;
                } finally {
                    releaseEntry();
                    await context.close();
                }
            }
} finally {
    await writeFile(
        path.join(output, `${dev ? 'dev-' : ''}${edges ? 'edges-' : ''}report.json`),
        JSON.stringify(
            {
                synthetic: true,
                mode: dev ? 'real-source' : 'production-artifact',
                checks,
                failures,
                requests: server.requests,
            },
            null,
            2,
        ),
    );
    await browser.close();
    await server.close();
    await vite?.close();
}
process.stdout.write(JSON.stringify({ checks: checks.length, failures: failures.length, output }) + '\n');
