import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fixtureData } from './fixtures.mjs';

const output = path.resolve(process.env.STOREFRONT_LAYOUT_OUTPUT || 'artifacts/store-layout-unification');
const baseUrl = process.env.STOREFRONT_VISUAL_BASE_URL || 'http://127.0.0.1:5189';
const publicContent = process.env.STOREFRONT_LAYOUT_CONTENT_PATH
    ? JSON.parse(await readFile(process.env.STOREFRONT_LAYOUT_CONTENT_PATH, 'utf8'))
    : null;
const assetMap = process.env.STOREFRONT_LAYOUT_ASSET_MAP
    ? JSON.parse(await readFile(process.env.STOREFRONT_LAYOUT_ASSET_MAP, 'utf8'))
    : null;
const stores = [
    { name: 'moyao', origin: 'https://moyaoai.com', preset: 'neo-minimalist', width: 1600, height: 800 },
    { name: 'damatong', origin: 'https://damatong.net', preset: 'modern-oriental', width: 2200, height: 715 },
];
const widths = process.env.STOREFRONT_LAYOUT_WIDTHS
    ? process.env.STOREFRONT_LAYOUT_WIDTHS.split(',').map(Number)
    : [390, 1024, 1440, 1920];
const results = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
function artwork(width, height) {
    return (
        'data:image/svg+xml,' +
        encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
                `<rect width="100%" height="100%" fill="#d6e3df"/>` +
                `<circle cx="${width * 0.8}" cy="${height * 0.5}" r="${height * 0.35}" fill="#618b82"/></svg>`,
        )
    );
}
function content(store, real) {
    const data = structuredClone(fixtureData(store.preset));
    if (real) {
        Object.assign(data, publicContent[store.origin]);
        data.storefrontContentSettings.heroAutoplayIntervalSeconds = 0;
        return data;
    }
    const hero = data.storefrontContent.find(block => block.type === 'HERO');
    hero.imageUrl = artwork(store.width, store.height);
    hero.imageAsset = { id: 'hero-art', preview: hero.imageUrl, width: store.width, height: store.height };
    data.storefrontContentSettings.heroAutoplayIntervalSeconds = 0;
    const trust = {
        ...hero,
        id: 'trust',
        type: 'TRUST_BAR',
        position: 1,
        imageUrl: null,
        items: ['商品信息', '订单可查', '帮助中心', '账户服务'].map((label, index) => ({
            id: `trust-${index}`,
            label,
            enabled: true,
            position: index,
        })),
    };
    if (store.name === 'damatong') data.storefrontContent.push(trust);
    for (const [index, type] of ['STORY', 'CUSTOM'].entries()) {
        data.storefrontContent.push({
            ...hero,
            id: `media-${type}`,
            type,
            position: 30 + index,
            targetType: 'NONE',
            targetValue: null,
            title: '统一媒体布局',
            items: [],
        });
    }
    return data;
}
try {
    for (const real of publicContent
        ? process.env.STOREFRONT_LAYOUT_REAL_ONLY
            ? [true]
            : [false, true]
        : [false]) {
        for (const width of widths) {
            const pair = [];
            for (const store of stores) {
                const page = await browser.newPage({
                    viewport: { width, height: 1000 },
                    reducedMotion: 'reduce',
                    locale: 'zh-CN',
                });
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                const data = content(store, real);
                await page.route('**/*', async route => {
                    const url = new URL(route.request().url());
                    if (url.pathname.includes('shop-api')) return route.fulfill({ json: { data } });
                    if (url.pathname.includes('storefront-realtime')) return route.abort();
                    if (real && url.pathname.startsWith('/assets/')) {
                        if (assetMap) {
                            const asset = assetMap[store.origin + decodeURIComponent(url.pathname)];
                            if (!asset) throw new Error(`Missing frozen asset: ${url.pathname}`);
                            return route.fulfill({
                                body: await readFile(asset.path),
                                contentType: asset.contentType,
                            });
                        }
                        const response = await route.fetch({
                            url: store.origin + url.pathname + url.search,
                            headers: { 'user-agent': 'Mozilla/5.0' },
                        });
                        return route.fulfill({ response });
                    }
                    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !real) return route.abort();
                    return route.continue();
                });
                await page.goto(baseUrl, { waitUntil: 'networkidle' });
                try {
                    await expect(page.locator('.hero-rich-backdrop')).toBeVisible();
                } catch (error) {
                    await page.screenshot({ path: path.join(output, 'failed-page.png') });
                    await writeFile(
                        path.join(output, 'failed-page.json'),
                        JSON.stringify({ errors, body: await page.locator('body').innerText() }, null, 2),
                    );
                    throw error;
                }
                await expect(page.locator('.quick-grid')).toBeVisible();
                await expect
                    .poll(() =>
                        page
                            .locator('.hero-rich-backdrop')
                            .evaluate(image => image.complete && image.naturalWidth > 0),
                    )
                    .toBe(true);
                const measure = () =>
                    page.evaluate(() => {
                        const bounds = selector => {
                            const element = document.querySelector(selector);
                            if (!element) return null;
                            const rect = element.getBoundingClientRect();
                            return {
                                x: rect.x,
                                y: rect.y + window.scrollY,
                                width: rect.width,
                                height: rect.height,
                            };
                        };
                        return {
                            hero: bounds('.hero'),
                            quick: bounds('.quick-grid'),
                            trust: bounds('.home-trust-bar'),
                            story: bounds('.content-story-layout'),
                            banner: bounds('.managed-content-banner'),
                            copy: bounds('.hero-rich-content'),
                            image: bounds('.hero-rich-backdrop'),
                            action: bounds('.hero-rich-cta-btn'),
                            imageFit: getComputedStyle(document.querySelector('.hero-rich-backdrop'))
                                .objectFit,
                            overflow: document.documentElement.scrollWidth > innerWidth + 1,
                        };
                    });
                const geometry = await measure();
                expect(geometry.overflow, `${store.name}/${width} horizontal overflow`).toBe(false);
                if (width < 1024) {
                    expect(geometry.imageFit).toBe('cover');
                    expect(geometry.image).toEqual(geometry.hero);
                    expect(geometry.copy.y).toBeGreaterThanOrEqual(geometry.hero.y);
                    expect(geometry.copy.y + geometry.copy.height).toBeLessThanOrEqual(
                        geometry.hero.y + geometry.hero.height,
                    );
                    expect(geometry.action.height).toBeGreaterThanOrEqual(44);
                    expect(geometry.action.y + geometry.action.height).toBeLessThanOrEqual(
                        geometry.hero.y + geometry.hero.height,
                    );
                }
                if (width >= 1024) {
                    expect(geometry.imageFit).toBe('contain');
                    expect(geometry.trust).not.toBeNull();
                    await expect(page.locator('.home-trust-item')).toHaveCount(4);
                    if (width >= 1440)
                        expect(Math.abs(geometry.hero.height - geometry.quick.height)).toBeLessThanOrEqual(1);
                    if (real) {
                        await page.locator('.desktop-hero-arrow.is-next').click();
                        const after = await measure();
                        expect(after.hero).toEqual(geometry.hero);
                        expect(after.quick).toEqual(geometry.quick);
                        expect(after.trust).toEqual(geometry.trust);
                    }
                }
                if (real && process.env.STOREFRONT_LAYOUT_SLIDES) {
                    const slides = data.storefrontContent.filter(block => block.type === 'HERO');
                    for (let index = 0; index < slides.length; index++) {
                        if (width < 1024) await page.locator('.hero-dot').nth(index).click();
                        else
                            await page
                                .locator(
                                    index === 0
                                        ? '.desktop-hero-arrow.is-previous'
                                        : '.desktop-hero-arrow.is-next',
                                )
                                .click();
                        await expect(page.locator('.hero-rich-title')).toHaveText(slides[index].title);
                        await expect
                            .poll(() =>
                                page
                                    .locator('.hero-rich-backdrop')
                                    .evaluate(image => image.complete && image.naturalWidth > 0),
                            )
                            .toBe(true);
                        const slide = await measure();
                        expect(slide.hero).toEqual(geometry.hero);
                        expect(slide.action.y).toBeGreaterThanOrEqual(slide.hero.y);
                        expect(slide.action.y + slide.action.height).toBeLessThanOrEqual(
                            slide.hero.y + slide.hero.height,
                        );
                        await page.locator('.hero').screenshot({
                            path: path.join(output, `${store.name}-${width}-slide-${index + 1}.png`),
                        });
                    }
                }
                if (real) {
                    const screenshot = { path: path.join(output, `${store.name}-${width}.png`) };
                    if (width >= 1440) await page.locator('.home-intro-grid').screenshot(screenshot);
                    else await page.screenshot(screenshot);
                }
                expect(errors).toEqual([]);
                results.push({ store: store.name, width, real, ...geometry, errors });
                pair.push(geometry);
                await page.unrouteAll({ behavior: 'wait' });
                await page.close();
            }
            if (width >= 1024) {
                for (const selector of real
                    ? ['hero', 'quick', 'trust']
                    : ['hero', 'quick', 'trust', 'story', 'banner']) {
                    for (const dimension of ['x', 'y', 'width', 'height']) {
                        expect(
                            Math.abs(pair[0][selector][dimension] - pair[1][selector][dimension]),
                            `${real ? 'public' : 'synthetic'}/${width}/${selector}/${dimension}`,
                        ).toBeLessThanOrEqual(1);
                    }
                }
            }
        }
    }
} finally {
    await writeFile(path.join(output, 'layout-results.json'), JSON.stringify(results, null, 2));
    for (const context of browser.contexts()) {
        for (const page of context.pages()) await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
    await browser.close();
}
process.stdout.write(`Store layout checks passed: ${results.length} store/viewport cases\n`);
