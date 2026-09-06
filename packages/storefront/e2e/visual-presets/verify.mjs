import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fixtureData } from './fixtures.mjs';
const output = path.resolve('artifacts/visual-presets');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const deferredThemeResults = [];
try {
    for (const preset of ['classic', 'modern-oriental']) {
        for (const width of [390, 1440]) {
            const page = await browser.newPage({
                viewport: { width, height: width === 390 ? 844 : 1000 },
                locale: 'zh-CN',
            });
            const errors = [];
            let signedIn = true;
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                if (url.pathname.includes('shop-api'))
                    return route.fulfill({
                        contentType: 'application/json',
                        body: JSON.stringify({ data: fixtureData(preset, signedIn) }),
                    });
                if (url.pathname.includes('/storefront-realtime'))
                    return route.fulfill({ status: 204, body: '' });
                return route.continue();
            });
            for (const [name, route, selector] of [
                ['home', '/', '.home-page'],
                ['product', '/product?id=product-1', '.product-detail-page'],
                ['cart', '/cart', '.cart-page'],
                ['checkout', '/checkout', '.checkout-page'],
                ['ai', '/image-studio', '.ai-studio-shell'],
                ['login', '/login', '.auth-page'],
                ['register', '/register', '.auth-page'],
            ]) {
                signedIn = !['login', 'register'].includes(name);
                await page.goto(`http://127.0.0.1:5188${route}`);
                await expect(page.locator('html')).toHaveAttribute('data-storefront-preset', preset);
                await expect(page.locator(selector)).toBeVisible({ timeout: 15000 });
                await page.screenshot({
                    path: `${output}/${preset}-${width}-${name}.png`,
                    fullPage: true,
                    animations: 'disabled',
                });
                const geometry = await page.evaluate(() => ({
                    viewport: innerWidth,
                    scroll: document.documentElement.scrollWidth,
                    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
                    background: getComputedStyle(document.body).backgroundColor,
                }));
                expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport + 1);
                if (preset === 'modern-oriental') expect(geometry.accent).toBe('#a63d32');
                if (preset === 'modern-oriental' && name === 'home') {
                    await expect(
                        page.locator('.storefront-bottom-nav a[aria-current="page"] > span:last-child'),
                    ).toHaveCSS('color', 'rgb(166, 61, 50)');
                    await expect(page.locator('.storefront-bottom-nav a[aria-current="page"] svg')).toHaveCSS(
                        'color',
                        'rgb(166, 61, 50)',
                    );
                }
                if (preset === 'modern-oriental' && name === 'login') {
                    await expect(page.locator('.auth-page .primary-action')).toHaveCSS(
                        'background-color',
                        'rgb(166, 61, 50)',
                    );
                }
                results.push({ preset, width, name, ...geometry });
                if (name === 'checkout') {
                    await page.getByRole('button', { name: /订单备注/ }).click();
                    const dialog = page.getByRole('dialog', { name: '订单备注' });
                    await expect(dialog).toBeVisible();
                    if (preset === 'modern-oriental')
                        await expect(dialog).toHaveCSS('background-color', 'rgb(255, 253, 248)');
                    await page.screenshot({
                        path: `${output}/${preset}-${width}-dialog.png`,
                        fullPage: true,
                        animations: 'disabled',
                    });
                    await page.keyboard.press('Escape');
                }
            }
            expect(errors).toEqual([]);
            await page.close();
        }
    }
    // Theme requests must never hide commerce pages or replace a form the customer is filling.
    for (const outcome of ['success', 'failure']) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let releaseTheme = () => undefined;
        let themeRequests = 0;
        const pendingTheme = new Promise(resolve => {
            releaseTheme = resolve;
        });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
            if (url.pathname.includes('shop-api')) {
                if (route.request().postDataJSON()?.query?.includes('query StorefrontVisualPreset')) {
                    themeRequests++;
                    await pendingTheme;
                    const body =
                        outcome === 'success'
                            ? { data: fixtureData('modern-oriental', false) }
                            : { errors: [{ message: 'Temporary visual preset read failure' }] };
                    return route
                        .fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
                        .catch(() => undefined);
                }
                return route.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify({ data: fixtureData('classic', false) }),
                });
            }
            if (url.pathname.includes('/storefront-realtime'))
                return route.fulfill({ status: 204, body: '' });
            return route.continue();
        });
        try {
            const started = Date.now();
            await page.goto('http://127.0.0.1:5188/login');
            await expect.poll(() => themeRequests).toBeGreaterThan(0);
            await expect(page.locator('.auth-page')).toBeVisible({ timeout: 5000 });
            const formVisibleMs = Date.now() - started;
            const email = page.locator('.auth-page input[type="email"]');
            const password = page.locator('.auth-page input[type="password"]');
            await email.fill('skin-regression@example.com');
            await password.fill('local-fixture-only');
            await email.evaluate(el => {
                el.dataset.presetRegression = 'original-form';
            });
            await page.screenshot({
                path: `${output}/deferred-theme-${outcome}-pending.png`,
                animations: 'disabled',
            });
            const initialThemeRequests = themeRequests;
            releaseTheme();
            if (outcome === 'success') {
                await expect(page.locator('html')).toHaveAttribute(
                    'data-storefront-preset',
                    'modern-oriental',
                );
            } else {
                await expect.poll(() => themeRequests).toBeGreaterThan(initialThemeRequests);
                await expect(page.locator('html')).toHaveAttribute('data-storefront-preset', 'classic');
            }
            await expect(email).toHaveValue('skin-regression@example.com');
            await expect(password).toHaveValue('local-fixture-only');
            await expect(email).toHaveAttribute('data-preset-regression', 'original-form');
            expect(errors).toEqual([]);
            deferredThemeResults.push({ outcome, formVisibleMs, themeRequests, formPreserved: true });
        } finally {
            releaseTheme();
            await page.close();
        }
    }
    await writeFile(
        `${output}/storefront-result.json`,
        JSON.stringify({ passed: true, mockedShopApi: true, results, deferredThemeResults }, null, 2),
    );
    process.stdout.write(
        `Storefront visual checks passed: ${results.length} pages plus checkout dialogs and deferred theme forms\n`,
    );
} finally {
    await browser.close();
}
