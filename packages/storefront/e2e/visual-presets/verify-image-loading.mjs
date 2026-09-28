import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';

import { fixtureData } from './fixtures.mjs';

const storefrontRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const distRoot = path.join(storefrontRoot, 'dist');
const output = path.join(storefrontRoot, 'artifacts/image-loading-qa');
const stores = [
    { name: 'moyao', preset: 'neo-minimalist' },
    { name: 'damatong', preset: 'classic' },
];
const viewports = [
    { name: 'mobile', width: 390, height: 844, reducedMotion: 'reduce' },
    { name: 'desktop', width: 1440, height: 900, reducedMotion: 'no-preference' },
];

function localizeImages(value) {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
        return '/assets/preview/qa-product.jpg';
    }
    if (Array.isArray(value)) return value.map(localizeImages);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeImages(item)]));
    }
    return value;
}

function storeFixture(preset) {
    const data = localizeImages(fixtureData(preset));
    const hero = data.storefrontContent.find(block => block.type === 'HERO');
    hero.imageUrl = '/assets/preview/qa-hero.jpg';
    hero.imageAsset = { id: 'qa-hero', preview: hero.imageUrl, width: 1600, height: 900 };
    data.storefrontContentSettings.heroAutoplayIntervalSeconds = 0;
    return data;
}

async function imageBuffers() {
    const files = await readdir(path.join(distRoot, 'assets'));
    const find = prefix =>
        path.join(
            distRoot,
            'assets',
            files.find(file => file.startsWith(prefix) && file.endsWith('.webp')),
        );
    const hero = await readFile(find('default-hero-1376-'));
    const product = await readFile(find('token-topup-v1-960-'));
    return {
        hero,
        product,
        heroPreview: await sharp(hero).resize({ width: 64 }).webp({ quality: 75 }).toBuffer(),
        productPreview: await sharp(product).resize({ width: 48 }).webp({ quality: 75 }).toBuffer(),
    };
}

function mimeType(filename) {
    if (filename.endsWith('.js')) return 'text/javascript';
    if (filename.endsWith('.css')) return 'text/css';
    if (filename.endsWith('.webp')) return 'image/webp';
    if (filename.endsWith('.jpg')) return 'image/jpeg';
    if (filename.endsWith('.png')) return 'image/png';
    if (filename.endsWith('.svg')) return 'image/svg+xml';
    if (filename.endsWith('.woff2')) return 'font/woff2';
    if (filename.endsWith('.json')) return 'application/json';
    return 'text/html';
}

async function withFixtureServer(data, assets, visit) {
    const mediaRequests = [];
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (url.pathname === '/shop-api') {
                response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                response.end(JSON.stringify({ data }));
                return;
            }
            if (url.pathname === '/storefront-realtime') {
                response.writeHead(204);
                response.end();
                return;
            }
            if (url.pathname.startsWith('/assets/preview/qa-')) {
                if (url.pathname.includes('qa-fail')) {
                    response.writeHead(404);
                    response.end();
                    return;
                }
                const hero = url.pathname.includes('qa-hero');
                const preview = url.searchParams.get('preset')?.includes('placeholder') ?? false;
                mediaRequests.push({ path: url.pathname, preset: url.searchParams.get('preset'), preview });
                await new Promise(resolve => setTimeout(resolve, preview ? 120 : 1100));
                response.writeHead(200, {
                    'content-type': 'image/webp',
                    'cache-control': 'public,max-age=3600,immutable',
                });
                response.end(
                    assets[
                        hero ? (preview ? 'heroPreview' : 'hero') : preview ? 'productPreview' : 'product'
                    ],
                );
                return;
            }
            const assetPath =
                url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
            const filename = path.resolve(distRoot, `.${assetPath}`);
            if (!filename.startsWith(`${distRoot}${path.sep}`)) {
                response.writeHead(403);
                response.end();
                return;
            }
            const body = await readFile(filename);
            const compress =
                /\.(?:html|js|css|json)$/u.test(filename) &&
                request.headers['accept-encoding']?.includes('gzip');
            response.writeHead(200, {
                'content-type': mimeType(filename),
                'cache-control': filename.endsWith('index.html') ? 'no-cache' : 'public,max-age=3600',
                ...(compress ? { 'content-encoding': 'gzip' } : {}),
            });
            response.end(compress ? gzipSync(body) : body);
        } catch {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        return await visit(`http://127.0.0.1:${server.address().port}`, mediaRequests);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

function installVitals(page) {
    return page.addInitScript(() => {
        window.__qaVitals = { lcp: null, cls: 0, events: [] };
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.__qaVitals.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__qaVitals.cls += entry.value;
            }
        }).observe({ type: 'layout-shift', buffered: true });
        if (PerformanceObserver.supportedEntryTypes.includes('event')) {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) window.__qaVitals.events.push(entry.duration);
            }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
        }
    });
}

await mkdir(output, { recursive: true });
const images = await imageBuffers();
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const store of stores) {
        const data = storeFixture(store.preset);
        await withFixtureServer(data, images, async (baseUrl, mediaRequests) => {
            for (const viewport of viewports) {
                const context = await browser.newContext({
                    viewport: { width: viewport.width, height: viewport.height },
                    reducedMotion: viewport.reducedMotion,
                    serviceWorkers: 'block',
                });
                const page = await context.newPage();
                const cdp = await context.newCDPSession(page);
                await cdp.send('Network.emulateNetworkConditions', {
                    offline: false,
                    latency: 150,
                    downloadThroughput: 200_000,
                    uploadThroughput: 100_000,
                });
                await installVitals(page);
                try {
                    const beforeRequests = mediaRequests.length;
                    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
                    const hero = page.locator('.hero .safe-image-frame').first();
                    await hero.waitFor({ state: 'visible' });
                    await expect(hero.locator('.safe-image-preview.is-ready')).toBeVisible();
                    await expect(hero.locator('.safe-image-preview')).toHaveCSS('object-fit', 'cover');
                    await expect(hero.locator(':scope > img')).toHaveCSS('opacity', '0');
                    await page.screenshot({
                        path: path.join(output, `${store.name}-${viewport.name}-preview.png`),
                    });
                    await expect(hero).toHaveAttribute('data-safe-image', 'ready');
                    await expect(hero.locator(':scope > img')).toHaveCSS('opacity', '1');
                    await page.screenshot({
                        path: path.join(output, `${store.name}-${viewport.name}-ready.png`),
                    });
                    const coldRequests = mediaRequests.length - beforeRequests;
                    const coldVitals = await page.evaluate(() => ({
                        ...window.__qaVitals,
                        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
                        slowResources: performance
                            .getEntriesByType('resource')
                            .sort((a, b) => b.duration - a.duration)
                            .slice(0, 6)
                            .map(entry => ({
                                path: new URL(entry.name).pathname,
                                durationMs: Math.round(entry.duration),
                                transferBytes: entry.transferSize,
                            })),
                    }));
                    const beforeWarm = mediaRequests.length;
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    await expect(page.locator('.hero .safe-image-frame').first()).toHaveAttribute(
                        'data-safe-image',
                        'ready',
                    );
                    const warmRequests = mediaRequests.length - beforeWarm;
                    const warmVitals = await page.evaluate(() => window.__qaVitals);
                    await page.getByRole('button', { name: 'Necessary only' }).click();
                    await page.waitForTimeout(200);
                    const interactionEvents = await page.evaluate(() => window.__qaVitals.events);
                    await page.goto(`${baseUrl}/category`, { waitUntil: 'domcontentloaded' });
                    try {
                        await expect(
                            page.locator('main.category-page, main.desktop-catalog-main'),
                        ).toBeVisible({ timeout: 15_000 });
                    } catch (error) {
                        process.stderr.write(
                            `${store.name}/${viewport.name} category: ${(await page.locator('body').innerText()).slice(0, 800)}\n`,
                        );
                        throw error;
                    }
                    const categoryImage = page.locator('main [data-safe-image]').first();
                    await expect(categoryImage.locator('.safe-image-preview')).toHaveCount(1);
                    await expect(categoryImage).toHaveAttribute('data-safe-image', 'ready');
                    await page.goto(`${baseUrl}/product?id=product-1`, { waitUntil: 'domcontentloaded' });
                    const productImage = page.locator('main [data-safe-image]').first();
                    await expect(productImage.locator('.safe-image-preview')).toHaveCount(1);
                    await expect(productImage).toHaveAttribute('data-safe-image', 'ready');
                    results.push({
                        store: store.name,
                        viewport: viewport.name,
                        coldImageRequests: coldRequests,
                        warmImageRequests: warmRequests,
                        coldLcpMs: Math.round(coldVitals.lcp ?? 0),
                        coldFcpMs: Math.round(coldVitals.fcp ?? 0),
                        warmLcpMs: Math.round(warmVitals.lcp ?? 0),
                        coldCls: Number(coldVitals.cls.toFixed(3)),
                        warmCls: Number(warmVitals.cls.toFixed(3)),
                        labInteractionDurationMs: interactionEvents.length
                            ? Math.max(...interactionEvents)
                            : null,
                        slowResources: coldVitals.slowResources,
                    });
                } finally {
                    await context.close();
                }
            }
        });
    }
    const failureData = storeFixture('neo-minimalist');
    const failureJson = JSON.stringify(failureData).replaceAll(
        '/assets/preview/qa-product.jpg',
        '/assets/preview/qa-fail.jpg',
    );
    await withFixtureServer(JSON.parse(failureJson), images, async baseUrl => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
            await page.goto(`${baseUrl}/product?id=product-1`, { waitUntil: 'domcontentloaded' });
            await expect(page.locator('main [data-safe-image="error"]').first()).toBeVisible({
                timeout: 15_000,
            });
            await page.screenshot({ path: path.join(output, 'image-failure.png') });
        } finally {
            await page.close();
        }
    });
} finally {
    await browser.close();
}
await writeFile(path.join(output, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(results)}\n`);
