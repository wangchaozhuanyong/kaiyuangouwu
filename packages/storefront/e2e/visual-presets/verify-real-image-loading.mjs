import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const store = process.env.STOREFRONT_REAL_STORE;
const baseUrl = process.env.STOREFRONT_REAL_BASE_URL;
if (!['moyao', 'damatong'].includes(store) || !baseUrl) {
    throw new Error('Set STOREFRONT_REAL_STORE=moyao|damatong and STOREFRONT_REAL_BASE_URL');
}
const storefrontRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const output = path.join(storefrontRoot, 'artifacts/image-loading-qa/real-local');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];
async function installVitals(page) {
    await page.addInitScript(() => {
        window.__imageQaVitals = { lcp: null, cls: 0, longTasks: [] };
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.__imageQaVitals.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__imageQaVitals.cls += entry.value;
            }
        }).observe({ type: 'layout-shift', buffered: true });
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) window.__imageQaVitals.longTasks.push(entry.duration);
            }).observe({ type: 'longtask', buffered: true });
        }
    });
}

async function expectReadyImage(frame) {
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator('.safe-image-preview')).toHaveCount(1);
    await expect(frame).toHaveAttribute('data-safe-image', 'ready', { timeout: 30_000 });
    await expect(frame.locator(':scope > img')).toHaveCSS('opacity', '1');
}

try {
    for (const viewport of [
        { name: 'mobile', width: 390, height: 844 },
        { name: 'desktop', width: 1440, height: 900 },
    ]) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            reducedMotion: viewport.name === 'mobile' ? 'reduce' : 'no-preference',
            serviceWorkers: 'block',
        });
        const page = await context.newPage();
        const errors = [];
        const imageResponses = [];
        const apiOperations = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            if (new URL(request.url()).pathname !== '/shop-api') return;
            const operation = request.postData()?.match(/\b(?:query|mutation)\s+(\w+)/u)?.[1];
            apiOperations.push(operation ?? 'anonymous');
        });
        page.on('response', async response => {
            if (!response.url().includes('/assets/preview/')) return;
            const headers = await response.allHeaders();
            imageResponses.push({
                path: new URL(response.url()).pathname,
                preset: new URL(response.url()).searchParams.get('preset'),
                status: response.status(),
                contentType: headers['content-type'] ?? '',
                cacheControl: headers['cache-control'] ?? '',
                contentLengthBytes: Number(headers['content-length']) || null,
            });
        });
        await installVitals(page);
        try {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            const hero = page.locator('.hero [data-safe-image]').first();
            await expectReadyImage(hero);
            const cold = await page.evaluate(() => ({
                lcp: window.__imageQaVitals.lcp,
                cls: window.__imageQaVitals.cls,
                longTaskCount: window.__imageQaVitals.longTasks.length,
                longestTaskMs: Math.round(Math.max(0, ...window.__imageQaVitals.longTasks)),
                blockingTimeMs: Math.round(
                    window.__imageQaVitals.longTasks.reduce(
                        (total, duration) => total + Math.max(0, duration - 50),
                        0,
                    ),
                ),
                fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
                highPriorityImageCount: document.querySelectorAll('img[fetchpriority="high"]').length,
                fontRequestCount: performance
                    .getEntriesByType('resource')
                    .filter(entry => /\.(?:woff2?|ttf)(?:[?#]|$)/u.test(entry.name)).length,
                heroImage: (() => {
                    const image = document.querySelector('.hero [data-safe-image] > img');
                    if (!(image instanceof HTMLImageElement)) return null;
                    const resource = performance.getEntriesByName(image.currentSrc).at(-1);
                    return {
                        path: new URL(image.currentSrc).pathname,
                        preset: new URL(image.currentSrc).searchParams.get('preset'),
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        encodedBytes: resource?.encodedBodySize ?? null,
                        transferBytes: resource?.transferSize ?? null,
                    };
                })(),
                resources: performance
                    .getEntriesByType('resource')
                    .sort((left, right) => right.duration - left.duration)
                    .slice(0, 8)
                    .map(entry => ({
                        path: new URL(entry.name).pathname,
                        durationMs: Math.round(entry.duration),
                        transferBytes: entry.transferSize,
                    })),
            }));
            cold.apiOperations = apiOperations.slice();
            await page.screenshot({ path: path.join(output, `${store}-${viewport.name}-home.png`) });

            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
            await expectReadyImage(page.locator('.hero [data-safe-image]').first());
            const warm = await page.evaluate(() => ({
                ...window.__imageQaVitals,
                imageResources: performance
                    .getEntriesByType('resource')
                    .filter(entry => entry.name.includes('/assets/preview/'))
                    .map(entry => ({
                        preset: new URL(entry.name).searchParams.get('preset'),
                        transferBytes: entry.transferSize,
                    })),
            }));

            await page.locator('a[href="/category"]').first().click();
            await expect(page.locator('main.category-page, main.desktop-catalog-main')).toBeVisible({
                timeout: 30_000,
            });
            await expectReadyImage(page.locator('main [data-safe-image]').first());
            await page.screenshot({ path: path.join(output, `${store}-${viewport.name}-category.png`) });

            const productLink = page.locator('main a[href^="/product"]:has(.safe-image-frame)').first();
            await expect(productLink).toBeVisible();
            let delayedProductRequests = 0;
            await page.route('**/shop-api?**', async route => {
                const body = route.request().postData() ?? '';
                if (body.includes('StorefrontProduct(')) {
                    delayedProductRequests++;
                    await new Promise(resolve => setTimeout(resolve, 1_400));
                }
                await route.continue();
            });
            await productLink.evaluate(link => link.click());
            await expect(page.getByRole('status', { name: /Opening product|正在打开商品/u })).toBeVisible();
            await expect(page.locator('main.category-page, main.desktop-catalog-main')).toBeVisible();
            await page.screenshot({
                path: path.join(output, `${store}-${viewport.name}-product-transition.png`),
            });
            await expect(page.locator('main.product-detail-page')).toBeVisible({ timeout: 30_000 });
            await expectReadyImage(page.locator('main.product-detail-page [data-safe-image]').first());
            expect(delayedProductRequests).toBeGreaterThan(0);
            await page.screenshot({ path: path.join(output, `${store}-${viewport.name}-product.png`) });
            expect(errors).toEqual([]);
            results.push({
                store,
                viewport: viewport.name,
                cold,
                warm,
                imageResponses,
                productUrl: new URL(page.url()).pathname,
                errors,
            });
        } finally {
            await context.close();
        }
    }

    // Hold only the full-size hero candidate until the small preview is visible.
    const previewContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
    });
    const previewPage = await previewContext.newPage();
    let releaseFullImage;
    const fullImageReleased = new Promise(resolve => {
        releaseFullImage = resolve;
    });
    try {
        await previewPage.route('**/assets/preview/**', async route => {
            if (route.request().url().includes('preset=storefront-hero-fit-')) {
                await fullImageReleased;
            }
            await route.continue();
        });
        await previewPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const hero = previewPage.locator('.hero [data-safe-image]').first();
        await expect(hero.locator('.safe-image-preview.is-ready')).toBeVisible({ timeout: 30_000 });
        await expect(hero.locator(':scope > img')).toHaveCSS('opacity', '0');
        await previewPage.screenshot({ path: path.join(output, `${store}-mobile-preview.png`) });
        releaseFullImage();
        await expectReadyImage(hero);
        results.push({ store, viewport: 'mobile-preview', previewBeforeDecode: true });
    } finally {
        releaseFullImage();
        await previewContext.close();
    }
} finally {
    await browser.close();
    await writeFile(path.join(output, `${store}-results.json`), JSON.stringify(results, null, 2));
}
process.stdout.write(
    JSON.stringify(
        results.map(({ store: name, viewport, cold, warm }) => ({
            store: name,
            viewport,
            coldLcpMs: Math.round(cold?.lcp ?? 0),
            warmLcpMs: Math.round(warm?.lcp ?? 0),
            coldCls: cold?.cls ?? 0,
        })),
    ) + '\n',
);
