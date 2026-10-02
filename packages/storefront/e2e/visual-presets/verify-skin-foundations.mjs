import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureData } from './fixtures.mjs';

const base = process.env.STOREFRONT_VISUAL_BASE_URL ?? 'http://127.0.0.1:5188';
const output = fileURLToPath(new URL('../../artifacts/skin-foundations/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const failures = [];
const routes = [
    ['home', '/'],
    ['category', '/category'],
    ['search', '/search?term=cup'],
    ['product', '/product?id=product-1'],
    ['cart', '/cart'],
    ['checkout', '/checkout'],
    ['account', '/account'],
    ['orders', '/orders'],
    ['order-detail', '/order-detail?id=order-1'],
    ['coupons', '/coupons'],
    ['legal', '/legal?id=privacy'],
    ['login', '/login'],
    ['404', '/not-found'],
];
const contrast = ([a, b]) => {
    const luminance = rgb => {
        const channels = rgb
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map(value => value / 255)
            .map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
        return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const [x, y] = [luminance(a), luminance(b)].sort((left, right) => right - left);
    return (x + 0.05) / (y + 0.05);
};
const jobs = ['classic', 'neo-minimalist'].flatMap(preset =>
    [320, 390, 1023, 1024, 1440, 1920, 2560].map(width => ({ preset, width })),
);
async function worker() {
    while (jobs.length) {
        const { preset, width } = jobs.shift();
        const page = await browser.newPage({
            viewport: { width, height: width < 1024 ? 844 : 1000 },
            locale: 'zh-CN',
            reducedMotion: 'reduce',
        });
        let routeName = 'home';
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => localStorage.setItem('storefront-analytics-opt-out:v1', '1'));
        await page.route('**/*', async request => {
            const url = new URL(request.request().url());
            if (!['localhost', '127.0.0.1'].includes(url.hostname)) return request.abort();
            if (url.pathname.includes('shop-api'))
                return request.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify({
                        data: fixtureData(
                            preset,
                            routeName !== 'login',
                            ['orders', 'order-detail'].includes(routeName)
                                ? 'aftercare'
                                : routeName === 'coupons'
                                  ? 'coupons'
                                  : 'dense',
                        ),
                    }),
                });
            if (url.pathname.includes('storefront-realtime'))
                return request.fulfill({ status: 204, body: '' });
            return request.continue();
        });
        for (const [name, url] of routes.filter(
            ([route]) =>
                !process.env.STOREFRONT_VISUAL_ROUTE || route === process.env.STOREFRONT_VISUAL_ROUTE,
        )) {
            routeName = name;
            const result = { preset, width, route: name };
            try {
                await page.goto(base + url, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                    () =>
                        document.querySelector(
                            '[data-page-readiness="ready"], [data-page-readiness="degraded"], [data-page-readiness="error"]',
                        ),
                    {},
                    { timeout: 15000 },
                );
                await expect(page.locator('html')).toHaveAttribute('data-storefront-preset', preset);
                await expect.poll(() => page.locator('[data-page-pending]').count()).toBe(0);
                await page.waitForTimeout(250);
                await expect
                    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
                    .toBe(true);
                result.type = await page.evaluate(() => {
                    const selectors = [
                        '.section-header h2',
                        '.account-section h2',
                        '.product-card-name',
                        '.detail-summary h1',
                        '.subpage-header > strong',
                        '.empty-state > h2',
                    ];
                    return selectors.flatMap(selector =>
                        [...document.querySelectorAll(selector)]
                            .filter(el => el.getBoundingClientRect().width > 0)
                            .slice(0, 4)
                            .map(el => ({
                                selector,
                                text: el.textContent.slice(0, 30),
                                size: getComputedStyle(el).fontSize,
                                line: getComputedStyle(el).lineHeight,
                            })),
                    );
                });
                if (name === 'product') {
                    await expect(page.locator('.detail-action-bar button').last()).toHaveCSS(
                        'border-radius',
                        '10px',
                    );
                    await expect(page.locator('.detail-summary h1').first()).toHaveCSS(
                        'font-size',
                        width < 1024 ? '22px' : '28px',
                    );
                    if (width < 1024) {
                        await page.evaluate(() => window.scrollTo(0, 650));
                        await expect(page.locator('.product-detail-header')).toHaveClass(/is-scrolled/);
                        const pair = await page.locator('.product-detail-header > strong').evaluate(el => {
                            const root = getComputedStyle(document.documentElement);
                            const swatch = document.createElement('span');
                            swatch.style.color = root.getPropertyValue('--surface');
                            document.body.append(swatch);
                            const bg = getComputedStyle(swatch).color;
                            swatch.remove();
                            return [getComputedStyle(el).color, bg];
                        });
                        result.headerContrast = contrast(pair);
                        assert.ok(result.headerContrast >= 4.5);
                    }
                }
                if (name === 'search' && width < 1024) {
                    for (const selector of ['.search-input-field', '.search-clear']) {
                        const box = await page.locator(selector).boundingBox();
                        assert.ok(box && box.height >= 44 && box.width >= 44, `${selector} touch target`);
                    }
                }
                if (name === 'order-detail') {
                    await expect(page.locator('.order-detail-actions')).toBeVisible();
                    const pair = await page
                        .locator('.order-detail-actions button')
                        .first()
                        .evaluate(el => {
                            let surface = el;
                            while (
                                surface &&
                                getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)'
                            )
                                surface = surface.parentElement;
                            return [
                                getComputedStyle(el).color,
                                getComputedStyle(surface ?? document.documentElement).backgroundColor,
                            ];
                        });
                    result.actionContrast = contrast(pair);
                    assert.ok(result.actionContrast >= 4.5);
                    await expect(page.locator('.order-detail-actions button').first()).toHaveCSS(
                        'border-radius',
                        '10px',
                    );
                }
                if (name === '404')
                    await expect(page.locator('.not-found-actions button').first()).toHaveCSS(
                        'border-radius',
                        '10px',
                    );
                if (name === 'login') {
                    const action = page.locator('.wide-action').first();
                    await page.keyboard.press('Tab');
                    await action.focus();
                    const pair = await action.evaluate(el => {
                        let surface = el.parentElement;
                        while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)')
                            surface = surface.parentElement;
                        return [
                            getComputedStyle(el).outlineColor,
                            getComputedStyle(surface ?? document.documentElement).backgroundColor,
                        ];
                    });
                    result.focusContrast = contrast(pair);
                    assert.ok(result.focusContrast >= 3);
                    await expect(action).toHaveCSS('outline-width', '2px');
                }
                if (
                    [390, 1440].includes(width) &&
                    ['account', 'product', 'order-detail', 'login'].includes(name)
                )
                    await page.screenshot({
                        path: `${output}/${preset}-${width}-${name}.png`,
                        animations: 'disabled',
                    });
                result.passed = true;
            } catch (error) {
                result.error = error.message.slice(0, 900);
                failures.push(result);
                await page.screenshot({
                    path: `${output}/failure-${preset}-${width}-${name}.png`,
                    animations: 'disabled',
                });
            }
            results.push(result);
        }
        if (errors.length) failures.push({ preset, width, errors });
        await page.close();
        process.stdout.write(`${preset} ${width}: routes checked\n`);
    }
}
try {
    await Promise.all([worker(), worker()]);
} finally {
    await browser.close();
}
await writeFile(
    `${output}/${process.env.STOREFRONT_VISUAL_ROUTE ?? 'all'}-results.json`,
    JSON.stringify({ results, failures }, null, 2),
);
assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
process.stdout.write(`Skin foundations: ${results.length} route/skin/viewport cases passed\n`);
