import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../visual-presets/fixtures.mjs';

const base = process.env.STOREFRONT_INTERACTION_TEST_URL ?? 'http://127.0.0.1:5326';
const output = fileURLToPath(new URL('../../artifacts/loading-refresh/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
const picture =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#c8d0df"/></svg>';
try {
    for (const [preset, width, locale] of [
        ['classic', 390, 'zh-CN'],
        ['neo-minimalist', 1440, 'en-US'],
    ]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, locale });
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        const data = fixtureData(preset, true, 'normal');
        data.myCustomerProductActivity = { favoriteProductIds: [], recentProductVisits: [] };
        data.storefrontDailyRecommendations = {
            businessDate: '2026-10-03',
            expiresAt: '2026-10-04T00:00:00Z',
            items: [],
        };
        let mode = 'initial-error';
        let contentReads = 0;
        let documentNavigations = 0;
        let releaseSlow;
        page.on('request', request => {
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentNavigations++;
        });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
            if (url.pathname.includes('shop-api')) {
                const body = route.request().postDataJSON();
                const content = /\bstorefrontContent\s*\{/u.test(String(body?.query));
                if (content) {
                    contentReads++;
                    if (mode.includes('error'))
                        return route.fulfill({
                            json: {
                                errors: [
                                    {
                                        message: 'Controlled local read failure',
                                        extensions: { code: 'INTERNAL_SERVER_ERROR' },
                                    },
                                ],
                            },
                        });
                    if (mode === 'slow') await gate;
                }
                return route.fulfill({ json: { data } });
            }
            if (url.pathname.includes('storefront-realtime')) return route.fulfill({ status: 204, body: '' });
            if (route.request().resourceType() === 'image')
                return route.fulfill({ contentType: 'image/svg+xml', body: picture });
            await route.continue();
        });
        await page.goto(`${base}/services`);
        const isZh = locale.startsWith('zh');
        await expect(page.locator('.business-services-page')).toHaveCount(0);
        const initialRetry = page.getByRole('button', { name: isZh ? '重试' : /Retry|Try again/i }).first();
        try {
            await expect(initialRetry).toBeVisible({ timeout: 20000 });
        } catch (error) {
            await page.screenshot({ path: `${output}/${preset}-${width}-initial-failure.png` });
            process.stdout.write(
                JSON.stringify({
                    contentReads,
                    errors,
                    pageText: (await page.locator('body').innerText()).slice(0, 1200),
                    url: page.url(),
                }) + '\n',
            );
            throw error;
        }
        mode = 'normal';
        await initialRetry.click();
        await expect(page.locator('.business-services-page')).toBeVisible();
        expect(documentNavigations).toBe(1);
        checks.push(
            `${preset}/${width}/${locale}: initial content failure with available products recovers through local retry with no document reload`,
        );

        // Vite adds an HMR timestamp to imports; use the module mounted by the actual app.
        const queryModule = await page.evaluate(
            () =>
                performance
                    .getEntriesByType('resource')
                    .find(entry => new URL(entry.name).pathname === '/src/query-client.ts')?.name,
        );
        expect(queryModule).toBeTruthy();
        const refreshContent = () =>
            page.evaluate(async moduleUrl => {
                const { storefrontQueryClient } = await import(moduleUrl);
                if (!storefrontQueryClient.getQueryCache().getAll().length)
                    throw new Error('Actual app QueryClient was not selected');
                void storefrontQueryClient.refetchQueries(
                    { type: 'active', predicate: query => query.queryKey[3] === 'content' },
                    { cancelRefetch: false },
                );
            }, queryModule);
        const baselineReads = contentReads;
        mode = 'slow';
        const gate = new Promise(resolve => {
            releaseSlow = resolve;
        });
        await refreshContent();
        await refreshContent();
        try {
            await expect(page.locator('[data-query-feedback=refreshing]')).toBeVisible();
        } catch (error) {
            process.stdout.write(
                JSON.stringify({
                    contentReads,
                    baselineReads,
                    queries: await page.evaluate(async moduleUrl => {
                        const { storefrontQueryClient } = await import(moduleUrl);
                        return storefrontQueryClient
                            .getQueryCache()
                            .getAll()
                            .map(query => ({
                                key: query.queryKey,
                                active: query.isActive(),
                                status: query.state.status,
                                fetchStatus: query.state.fetchStatus,
                                hasData: query.state.data !== undefined,
                            }));
                    }, queryModule),
                }) + '\n',
            );
            throw error;
        }
        await expect(page.locator('.business-services-page')).toBeVisible();
        expect(contentReads - baselineReads).toBe(1);
        releaseSlow();
        await expect(page.locator('[data-query-feedback=refreshing]')).toHaveCount(0);
        checks.push(
            `${preset}/${width}/${locale}: slow repeated refresh retains content and joins one request`,
        );

        mode = 'refresh-error';
        await refreshContent();
        await expect(page.locator('[data-query-feedback=error]')).toBeVisible();
        await expect(page.locator('.business-services-page')).toBeVisible();
        await expect(page.locator('[data-query-feedback=error]')).toContainText(
            isZh ? '保留上次内容' : 'Previous content',
        );
        for (const button of await page.locator('.traffic-consent-banner button').all()) {
            await button.click({ trial: true });
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const retry = page
            .locator('[data-query-feedback=error]')
            .getByRole('button', { name: isZh ? '重试' : 'Retry', exact: true });
        await retry.focus();
        await expect(retry).toBeFocused();
        await page.screenshot({ path: `${output}/${preset}-${width}-refresh-error.png` });
        mode = 'normal';
        await retry.press('Enter');
        await expect(page.locator('[data-query-feedback=error]')).toHaveCount(0);
        await expect(page.locator('.business-services-page')).toBeVisible();
        expect(documentNavigations).toBe(1);
        checks.push(
            `${preset}/${width}/${locale}: background error retains content, keyboard retry recovers locally, no page overflow`,
        );

        for (const routePath of [
            '/category?sort=sales&inStockOnly=true',
            '/search?term=cup',
            '/account',
            '/coupons',
            '/referral',
            '/reviews',
            '/orders',
        ]) {
            await page.goto(`${base}${routePath}`);
            await expect(page.locator('#storefront-content')).toBeVisible();
            await expect(page.locator('[data-page-readiness]')).toHaveAttribute(
                'data-page-readiness',
                /ready|degraded/,
            );
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
                true,
            );
            checks.push(`${preset}/${width}: ${routePath} renders with no page overflow`);
        }
        await page.goto(`${base}/category?sort=sales&inStockOnly=true`);
        await page.reload();
        expect(new URL(page.url()).searchParams.get('sort')).toBe('sales');
        expect(new URL(page.url()).searchParams.get('inStockOnly')).toBe('true');
        checks.push(`${preset}/${width}: hard refresh retains URL filters`);
        if (width === 1440) {
            await page.goto(`${base}/__storefront-preview`);
            await expect(page.locator('.storefront-preview-toolbar')).toBeVisible();
            await expect(page.locator('.storefront-preview-stage iframe')).toHaveCount(1);
            checks.push(`${preset}/${width}: lazily loaded design preview renders its controls and iframe`);
        }
        await page.close();
    }
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/checks.json`,
        JSON.stringify(
            {
                source: 'Actual local storefront with in-memory Shop API fixtures, no production account or backend',
                base,
                checks,
                errors,
            },
            null,
            2,
        ),
    );
    process.stdout.write(`Browser interaction checks passed: ${checks.length}\n`);
} finally {
    await browser.close();
}
