import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fixtureData } from './fixtures.mjs';

const output = path.resolve('artifacts/mobile-catalog-alignment');
const baseUrl = process.env.STOREFRONT_VISUAL_BASE_URL || 'http://127.0.0.1:5189';
const publicCollections = JSON.parse(await readFile(path.join(output, 'damatong-collections.json'), 'utf8'))
    .data.collections;
const assetMap = JSON.parse(await readFile(path.join(output, 'asset-map.json'), 'utf8'));
const presets = ['classic', 'modern-oriental', 'neo-minimalist'];
const cases = presets.flatMap(preset =>
    [320, 390, 430, 1023].map(width => ({ preset, width, language: 'zh', count: 6 })),
);
cases.push(
    ...[320, 390, 1023].map(width => ({ preset: 'modern-oriental', width, language: 'en', count: 6 })),
    ...[0, 1, 2].map(count => ({ preset: 'modern-oriental', width: 390, language: 'zh', count })),
);
const results = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
    for (const { preset, width, language, count } of cases) {
        const page = await browser.newPage({
            viewport: { width, height: 844 },
            locale: language === 'zh' ? 'zh-CN' : 'en-GB',
            reducedMotion: 'reduce',
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => localStorage.setItem('storefront-analytics-opt-out:v1', '1'));
        const data = structuredClone(fixtureData(preset));
        data.collections = { items: publicCollections.items.slice(0, count), totalItems: count };
        if (language === 'en') {
            for (const collection of data.collections.items) {
                collection.name = 'Everyday essentials and specialty products';
            }
        }
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.pathname.includes('shop-api')) return route.fulfill({ json: { data } });
            const asset = assetMap[decodeURI(url.origin + url.pathname)];
            if (asset)
                return route.fulfill({ body: await readFile(asset.path), contentType: asset.contentType });
            if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
            if (url.pathname.includes('storefront-realtime')) return route.fulfill({ status: 204, body: '' });
            return route.continue();
        });
        await page.goto(`${baseUrl}/category`);
        await expect(page.locator('html')).toHaveAttribute('lang', language === 'zh' ? 'zh-CN' : 'en');
        await expect(page.locator('.primary-categories button')).toHaveCount(count + 1);
        await expect(page.locator('.category-product-list .product-row').first()).toBeVisible();
        await expect
            .poll(() =>
                page
                    .locator('.primary-category-image img')
                    .evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)),
            )
            .toBe(true);
        const geometry = await page.evaluate(() => {
            const rect = selector => {
                const bounds = document.querySelector(selector).getBoundingClientRect();
                return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
            };
            return {
                header: rect('.category-topbar'),
                switcher: rect('.primary-category-switcher'),
                strip: rect('.primary-category-strip'),
                first: rect('.primary-categories button'),
                all: rect('.primary-categories-all'),
                image: rect('.primary-category-image'),
                allImage: rect('.primary-categories-all-icon'),
                sort: rect('.sort-bar'),
                product: rect('.category-product-list .product-row'),
                headerBackground: getComputedStyle(document.querySelector('.category-topbar'))
                    .backgroundColor,
                rowBackground: getComputedStyle(document.querySelector('.primary-category-switcher'))
                    .backgroundColor,
                overflow: document.documentElement.scrollWidth - innerWidth,
            };
        });
        expect(geometry.header.height).toBe(52);
        expect(geometry.switcher.height).toBe(96);
        expect(geometry.image.height).toBe(44);
        expect(geometry.allImage.height).toBe(44);
        expect(geometry.image.y).toBe(geometry.allImage.y);
        expect(geometry.sort.y - geometry.switcher.y - geometry.switcher.height).toBe(12);
        expect(geometry.product.y - geometry.sort.y - geometry.sort.height).toBe(12);
        expect(geometry.headerBackground).toBe(geometry.rowBackground);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        for (const key of ['strip', 'sort', 'product']) expect(geometry[key].x).toBe(16);
        if (language === 'zh') expect(geometry.first.width).toBeCloseTo(geometry.all.width, 0);
        const name = `${preset}-${width}-${language}-${count}`;
        await page.screenshot({ path: path.join(output, `${name}.png`) });
        if (preset === 'modern-oriental' && width === 390 && language === 'zh' && count === 6) {
            await page.screenshot({
                path: path.join(output, 'after-category-top-390.png'),
                clip: { x: 0, y: 0, width, height: geometry.product.y },
            });
            await page.getByRole('button', { name: '全部分类', exact: true }).click();
            await expect(page.locator('.all-primary-category-grid button')).toHaveCount(count);
            await page.screenshot({ path: path.join(output, 'after-expanded-390.png') });
            await page.getByRole('button', { name: '点击收起', exact: true }).click();
            await page.locator('.primary-categories button').nth(1).click();
            await expect(page.locator('.category-layout.has-sidebar')).toBeVisible();
            await expect(page.locator('.primary-categories button').nth(1)).toHaveAttribute(
                'aria-pressed',
                'true',
            );
            await page.screenshot({ path: path.join(output, 'after-selected-390.png') });
        }
        expect(errors).toEqual([]);
        results.push({ preset, width, language, count, ...geometry });
        await page.unrouteAll({ behavior: 'wait' });
        await page.close();
    }
    await writeFile(path.join(output, 'catalog-results.json'), JSON.stringify(results, null, 2));
    process.stdout.write(
        `Catalog alignment passed: ${results.length} cases, real public category artwork, expansion and selection\n`,
    );
} finally {
    await browser.close();
}
