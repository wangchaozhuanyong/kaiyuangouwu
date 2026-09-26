import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { fixtureData } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const output = path.resolve('artifacts/visual-presets');
const baseUrl = process.env.STOREFRONT_VISUAL_BASE_URL || 'http://127.0.0.1:5188';
const requestedPreset = process.env.STOREFRONT_VISUAL_PRESET;
const requestedRoute = process.env.STOREFRONT_VISUAL_ROUTE;
const requestedWidth = Number(process.env.STOREFRONT_VISUAL_WIDTH || 0);
const requestedContent = process.env.STOREFRONT_VISUAL_CONTENT || 'normal';
const verifyProductNavigation = requestedContent.startsWith('product-navigation');
const presets = requestedPreset ? [requestedPreset] : ['classic', 'modern-oriental', 'neo-minimalist'];
const expectedPaletteSignature = {
    classic: { page: '#f1f5f9', surface: '#ffffff', text: '#0f172a', brand: '#3558aa' },
    'modern-oriental': { page: '#f1ece2', surface: '#fffaf1', text: '#1c302d', brand: '#9f3b30' },
    'neo-minimalist': { page: '#070b14', surface: '#0e1421', text: '#f4f7fb', brand: '#8b5cf6' },
};
const routes = [
    ['home', '/'],
    ['category', '/category'],
    ['services', '/services'],
    ['cart', '/cart'],
    ['account', '/account'],
    ['product', '/product?id=product-1'],
    ['search', '/search?term=cup'],
    ['search-discovery', '/search'],
    ['purchase', '/purchase'],
    ['checkout', '/checkout'],
    ['payment', '/payment'],
    ['order-confirmation', '/order-confirmation?id=QA0001'],
    ['orders', '/orders'],
    ['logistics', '/logistics'],
    ['order-detail', '/order-detail?id=order-1'],
    ['addresses', '/addresses'],
    ['account-security', '/account-security'],
    ['favorites', '/favorites'],
    ['history', '/history'],
    ['notifications', '/notifications'],
    ['coupons', '/coupons'],
    ['referral', '/referral'],
    ['flash-sale', '/flash-sale'],
    ['recommendations', '/recommendations'],
    ['support', '/support'],
    ['reviews', '/reviews'],
    ['image-studio', '/image-studio'],
    ['two-factor', '/two-factor'],
    ['mail-query', '/mail-query'],
    ['login', '/login'],
    ['register', '/register'],
    ['verify-account', '/verify-account'],
    ['forgot-password', '/forgot-password'],
    ['reset-password', '/reset-password'],
    ['legal', '/legal?id=privacy'],
    ['not-found', '/not-found'],
];
const criticalRoutes = new Set([
    'home',
    'category',
    'services',
    'product',
    'cart',
    'purchase',
    'checkout',
    'account',
    'login',
    'register',
    'image-studio',
]);
const anonymousRoutes = new Set(['login', 'register', 'verify-account', 'forgot-password', 'reset-password']);

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const contrastFailures = [];

function opaqueRgb(value) {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/u.exec(value);
    if (!match || (match[4] != null && Number(match[4]) !== 1)) {
        throw new Error(`Expected an opaque RGB control color, received ${value}`);
    }
    return match.slice(1, 4).map(Number);
}

function textContrast(foreground, background) {
    const luminance = value => {
        const channels = opaqueRgb(value).map(channel => {
            const normalized = channel / 255;
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}
try {
    for (const preset of presets) {
        for (const width of requestedWidth ? [requestedWidth] : [390, 1023, 1024, 1440]) {
            const scopedRoutes =
                requestedRoute || requestedWidth || width === 390 || width === 1440
                    ? routes
                    : routes.filter(([name]) => criticalRoutes.has(name));
            const selectedRoutes = requestedRoute
                ? scopedRoutes.filter(([name]) => requestedRoute.split(',').includes(name))
                : scopedRoutes;
            if (requestedRoute && selectedRoutes.length === 0) {
                throw new Error(`No visual routes matched ${requestedRoute} at ${width}px`);
            }
            const page = await browser.newPage({
                viewport: { width, height: width < 1024 ? 844 : 1000 },
                locale: 'zh-CN',
                reducedMotion: 'reduce',
            });
            const errors = [];
            const today = new Date();
            today.setHours(12, 0, 0, 0);
            const earlier = new Date(today);
            earlier.setDate(earlier.getDate() - 7);
            const savedProductsActivity = {
                favoriteProductIds: ['product-1', 'product-2'],
                recentProductVisits: [
                    { productId: 'product-1', visitedAt: today.toISOString() },
                    { productId: 'product-2', visitedAt: earlier.toISOString() },
                ],
            };
            let signedIn = true;
            const notificationReadKeys = new Set(['ORDER:notification-order-0:2026-09-23T08:00:00.000Z']);
            page.on('pageerror', error => errors.push(error.message));
            if (
                ['product-detail', 'mail-query-surfaces'].includes(requestedContent) ||
                requestedContent.startsWith('image-studio-') ||
                requestedContent === 'planned-fixes'
            ) {
                await page.addInitScript(() => localStorage.setItem('storefront-analytics-opt-out:v1', '1'));
            }
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                if (url.pathname.includes('shop-api')) {
                    const data = fixtureData(preset, signedIn, requestedContent);
                    if (verifyProductNavigation) {
                        data.myCustomerProductActivity = savedProductsActivity;
                        data.storefrontContentSettings.configuredBlockTypes.push('RECOMMENDATIONS');
                        data.storefrontContent.push({
                            ...data.storefrontContent[0],
                            id: 'qa-product-navigation',
                            code: 'qa-product-navigation',
                            type: 'RECOMMENDATIONS',
                            position: 3,
                            title: '推荐商品',
                        });
                        if (requestedContent === 'product-navigation-ai') {
                            const product = {
                                ...data.product,
                                name: 'ChatGPT Plus',
                                featuredAsset: null,
                                assets: [],
                            };
                            data.product = product;
                            data.products.items = [product];
                            data.storefrontCatalog.items = [product];
                        }
                    }
                    if (requestedContent === 'saved-products') {
                        const request = route.request().postDataJSON();
                        const query = String(request.query ?? '');
                        if (query.includes('removeMyFavoriteProducts')) {
                            const removed = new Set(request.variables?.productIds ?? []);
                            savedProductsActivity.favoriteProductIds =
                                savedProductsActivity.favoriteProductIds.filter(id => !removed.has(id));
                        }
                        data.myCustomerProductActivity = savedProductsActivity;
                        data.removeMyFavoriteProducts = savedProductsActivity;
                    }
                    if (requestedContent === 'notifications') {
                        const request = route.request().postDataJSON();
                        if (String(request.query).includes('markMyStoreNotificationsRead')) {
                            for (const reference of request.variables?.references ?? []) {
                                notificationReadKeys.add(
                                    `${reference.kind}:${reference.sourceId}:${new Date(reference.version).toISOString()}`,
                                );
                            }
                        }
                        data.myStoreNotificationReadKeys = [...notificationReadKeys];
                        data.markMyStoreNotificationsRead = [...notificationReadKeys];
                    }
                    return route.fulfill({
                        contentType: 'application/json',
                        body: JSON.stringify({ data }),
                    });
                }
                if (url.pathname.includes('/storefront-realtime')) {
                    return route.fulfill({ status: 204, body: '' });
                }
                return route.continue();
            });

            for (const [name, route] of selectedRoutes) {
                signedIn = !anonymousRoutes.has(name);
                await page.goto(`${baseUrl}${route}`);
                await expect(page.locator('html')).toHaveAttribute('data-storefront-preset', preset, {
                    timeout: 15000,
                });
                await expect(page.locator('#storefront-content')).toBeVisible({ timeout: 15000 });
                await expect(page.locator('[data-page-readiness]')).toHaveAttribute(
                    'data-page-readiness',
                    /ready|degraded/,
                    { timeout: 15000 },
                );
                const paletteSignature = await page.evaluate(() => {
                    const style = getComputedStyle(document.documentElement);
                    return {
                        page: style.getPropertyValue('--bg').trim(),
                        surface: style.getPropertyValue('--paper').trim(),
                        text: style.getPropertyValue('--text').trim(),
                        brand: style.getPropertyValue('--brand-primary').trim(),
                    };
                });
                expect(paletteSignature, `${preset}/${width}/${name} skin identity`).toEqual(
                    expectedPaletteSignature[preset],
                );
                await page.addStyleTag({
                    content: `
                        *, *::before, *::after {
                            animation-delay: 0s !important;
                            animation-duration: 0s !important;
                            transition-delay: 0s !important;
                            transition-duration: 0s !important;
                        }
                    `,
                });
                await page.evaluate(() =>
                    Promise.all(
                        document
                            .getAnimations()
                            .filter(
                                animation =>
                                    animation.playState !== 'finished' &&
                                    animation.effect?.getComputedTiming().iterations !== Infinity,
                            )
                            .map(animation => animation.finished.catch(() => undefined)),
                    ),
                );
                await page.addScriptTag({ path: axePath });
                const geometry = await page.evaluate(() => {
                    const frame = document.querySelector('.desktop-shell-frame');
                    const frameRect = frame?.getBoundingClientRect();
                    const headerRect = document.querySelector('.proto-header-inner')?.getBoundingClientRect();
                    const content = document.querySelector('#storefront-content');
                    const contentRect = content?.getBoundingClientRect();
                    const routeRoot = content?.querySelector(
                        ':scope > :is(main, .page, .subpage, .desktop-catalog-main, .desktop-commerce-frame, .mail-query-page)',
                    );
                    const routeRootRect = routeRoot?.getBoundingClientRect();
                    const viewportWidth = document.documentElement.clientWidth;
                    return {
                        viewport: viewportWidth,
                        scroll: document.documentElement.scrollWidth,
                        frameLeft: frameRect?.left ?? null,
                        frameRight: frameRect ? viewportWidth - frameRect.right : null,
                        headerLeft: headerRect?.left ?? null,
                        headerRight: headerRect ? viewportWidth - headerRect.right : null,
                        contentLeft: contentRect?.left ?? null,
                        contentRight: contentRect ? viewportWidth - contentRect.right : null,
                        routeRootLeft: routeRootRect?.left ?? null,
                        routeRootRight: routeRootRect ? viewportWidth - routeRootRect.right : null,
                        accountLayout: frame?.classList.contains('desktop-account-layout') ?? false,
                        pageFamily:
                            document.querySelector('.storefront-app')?.getAttribute('data-page-family') ??
                            null,
                    };
                });
                expect(geometry.scroll, `${preset}/${width}/${name} horizontal overflow`).toBeLessThanOrEqual(
                    geometry.viewport + 1,
                );
                if (width >= 1024) {
                    expect(geometry.frameLeft, `${preset}/${width}/${name} desktop frame`).not.toBeNull();
                    expect(
                        Math.abs(geometry.frameLeft - geometry.frameRight),
                        `${preset}/${width}/${name} frame symmetry`,
                    ).toBeLessThanOrEqual(1);
                    const expectedInset = Math.max(32, (geometry.viewport - 1280) / 2);
                    expect(
                        Math.abs(geometry.frameLeft - expectedInset),
                        `${preset}/${width}/${name} centered 1280px content`,
                    ).toBeLessThanOrEqual(1);
                    if (geometry.headerLeft != null && geometry.headerRight != null) {
                        expect(
                            Math.abs(geometry.headerLeft - geometry.frameLeft),
                            `${preset}/${width}/${name} header left edge`,
                        ).toBeLessThanOrEqual(1);
                        expect(
                            Math.abs(geometry.headerRight - geometry.frameRight),
                            `${preset}/${width}/${name} header right edge`,
                        ).toBeLessThanOrEqual(1);
                    }
                    if (
                        !geometry.accountLayout &&
                        geometry.pageFamily !== 'auth' &&
                        geometry.routeRootLeft != null &&
                        geometry.routeRootRight != null
                    ) {
                        expect(
                            Math.abs(geometry.routeRootLeft - geometry.frameLeft),
                            `${preset}/${width}/${name} route root left edge`,
                        ).toBeLessThanOrEqual(1);
                        expect(
                            Math.abs(geometry.routeRootRight - geometry.frameRight),
                            `${preset}/${width}/${name} route root right edge`,
                        ).toBeLessThanOrEqual(1);
                    }
                    if (
                        geometry.accountLayout &&
                        geometry.routeRootLeft != null &&
                        geometry.routeRootRight != null
                    ) {
                        expect(
                            Math.abs(geometry.routeRootLeft - geometry.contentLeft),
                            `${preset}/${width}/${name} account root left edge`,
                        ).toBeLessThanOrEqual(1);
                        expect(
                            Math.abs(geometry.routeRootRight - geometry.contentRight),
                            `${preset}/${width}/${name} account root right edge`,
                        ).toBeLessThanOrEqual(1);
                    }
                }
                if (name === 'home' && width >= 1024) {
                    const alignment = await page.evaluate(() => {
                        const header = document.querySelector('.proto-header-inner')?.getBoundingClientRect();
                        const sections = ['.homepage-modules'];
                        return sections.map(selector => {
                            const rect = document.querySelector(selector)?.getBoundingClientRect();
                            return {
                                selector,
                                left: rect && header ? rect.left - header.left : null,
                                right: rect && header ? rect.right - header.right : null,
                            };
                        });
                    });
                    for (const section of alignment) {
                        expect(
                            section.left,
                            `${preset}/${width}/${section.selector} left alignment`,
                        ).not.toBeNull();
                        expect(
                            section.right,
                            `${preset}/${width}/${section.selector} right alignment`,
                        ).not.toBeNull();
                        expect(Math.abs(section.left)).toBeLessThanOrEqual(1);
                        expect(Math.abs(section.right)).toBeLessThanOrEqual(1);
                    }
                }
                if (width >= 1024 && name === 'account' && requestedContent === 'dense') {
                    const thumbs = page.locator('.desktop-order-product > .responsive-picture');
                    await expect(thumbs.first()).toBeVisible();
                    for (const thumb of await thumbs.all()) {
                        const bounds = await thumb.boundingBox();
                        expect(bounds.width).toBe(68);
                        expect(bounds.height).toBe(68);
                    }
                }
                if (width === 1280 && name === 'category') {
                    const columns = await page
                        .locator('.desktop-product-grid')
                        .evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
                    expect(columns).toBe(4);
                }
                if (width >= 1024 && ['coupons', 'support'].includes(name)) {
                    await expect(page.locator('.subpage-header')).toBeHidden();
                }
                if (name === 'product' && width >= 1024) {
                    const media = page.locator('.desktop-product-purchase .detail-gallery');
                    await expect(media).toBeVisible();
                    const box = await media.boundingBox();
                    expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThanOrEqual(1);
                    await expect(media.locator('img').first()).toHaveCSS('object-fit', 'contain');
                    const productSurface = await page.evaluate(() => {
                        const root = getComputedStyle(document.documentElement);
                        const price = getComputedStyle(document.querySelector('.detail-price-line'));
                        const option = getComputedStyle(document.querySelector('.detail-options button'));
                        return {
                            controlRadius: root.getPropertyValue('--skin-control-radius').trim(),
                            priceRadius: price.borderRadius,
                            priceBackground: price.backgroundColor,
                            optionRadius: option.borderRadius,
                        };
                    });
                    expect(productSurface.priceRadius, `${preset}/${width}/product price radius`).toBe(
                        productSurface.controlRadius,
                    );
                    expect(productSurface.optionRadius, `${preset}/${width}/product option radius`).toBe(
                        productSurface.controlRadius,
                    );
                    expect(
                        productSurface.priceBackground,
                        `${preset}/${width}/product price surface`,
                    ).not.toBe('rgba(0, 0, 0, 0)');
                    const description = page.locator('.detail-description');
                    await expect(description.locator('img, video, audio, iframe')).toHaveCount(0);
                    const [descriptionBox, tabsBox] = await Promise.all([
                        description.boundingBox(),
                        page.locator('.detail-content-tabs').boundingBox(),
                    ]);
                    expect(Math.abs(descriptionBox.x - tabsBox.x)).toBeLessThanOrEqual(1);
                    expect(Math.abs(descriptionBox.width - tabsBox.width)).toBeLessThanOrEqual(1);
                }
                if (name === 'product') {
                    const gallery = page.locator('.detail-gallery');
                    const thumbnails = page.locator('.detail-gallery-thumbnails');
                    await expect(
                        page.locator('.detail-description img, .detail-description video'),
                    ).toHaveCount(0);
                    if (requestedContent === 'product-detail') {
                        await expect(thumbnails.locator('button')).toHaveCount(2);
                        await expect(thumbnails).toBeVisible();
                        const [galleryBox, thumbnailsBox] = await Promise.all([
                            gallery.boundingBox(),
                            thumbnails.boundingBox(),
                        ]);
                        expect(thumbnailsBox.y).toBeGreaterThanOrEqual(galleryBox.y + galleryBox.height);
                        const originalSource = await gallery.locator('img').getAttribute('src');
                        const second = thumbnails.getByRole('button', { name: '查看第2张商品图' });
                        await second.click();
                        await expect(second).toHaveAttribute('aria-current', 'true');
                        await expect(gallery.locator('img')).not.toHaveAttribute('src', originalSource);
                        await expect(page.locator('.gallery-count')).toHaveText('2 / 2');
                        const first = thumbnails.getByRole('button', { name: '查看第1张商品图' });
                        await first.focus();
                        await page.keyboard.press('Enter');
                        await expect(gallery.locator('img')).toHaveAttribute('src', originalSource);
                        await expect(first).toHaveAttribute('aria-current', 'true');
                        await expect(page.locator('.detail-rich-text')).toContainText('商品文字与参数');
                    } else {
                        await expect(thumbnails).toHaveCount(0);
                    }
                }
                if (name === 'login' || name === 'register') {
                    await expect(page.locator('.auth-form-heading')).toBeVisible();
                    await expect(page.locator('.auth-assurance-item')).toHaveCount(4);
                    await expect(page.locator('.auth-route-tabs')).toHaveCount(0);
                    if (width >= 1024) {
                        await expect(page.locator('.auth-hero')).toBeVisible();
                        await expect(page.locator('.auth-hero img')).toBeVisible();
                        const [moduleBox, heroBox, formBox, assuranceBox] = await Promise.all([
                            page.locator('.auth-page').boundingBox(),
                            page.locator('.auth-hero').boundingBox(),
                            page.locator('.login-content').boundingBox(),
                            page.locator('.auth-assurance-rail').boundingBox(),
                        ]);
                        expect(heroBox?.y, `${preset}/${width}/${name} hero alignment`).toBe(formBox?.y);
                        expect(
                            Math.abs((heroBox?.x ?? 0) + (heroBox?.width ?? 0) - (formBox?.x ?? 0)),
                            `${preset}/${width}/${name} split alignment`,
                        ).toBeLessThanOrEqual(1);
                        expect(
                            Math.abs((moduleBox?.width ?? 0) - (assuranceBox?.width ?? 0)),
                            `${preset}/${width}/${name} assurance span`,
                        ).toBeLessThanOrEqual(1);
                    } else {
                        await expect(page.locator('.auth-hero')).toBeHidden();
                        await expect(page.locator('.auth-mobile-back-button')).toBeVisible();
                        expect(
                            await page.evaluate(
                                () =>
                                    document.documentElement.scrollWidth <=
                                    document.documentElement.clientWidth,
                            ),
                            `${preset}/${width}/${name} horizontal overflow`,
                        ).toBe(true);
                    }
                }
                if (name === 'category' && width >= 1024) {
                    if (requestedContent === 'category-banner') {
                        await expect(page.locator('.desktop-catalog-hero.has-image')).toBeVisible();
                        await expect(page.locator('.desktop-catalog-hero-side-image')).toBeVisible();
                        await page.screenshot({
                            path: `${output}/${preset}-${width}-category-banner.png`,
                            fullPage: true,
                            animations: 'disabled',
                        });
                    }
                    await expect(page.locator('.desktop-category-navigation')).toBeVisible();
                    await expect(page.locator('.desktop-local-navigation')).toBeVisible();
                    await expect(page.locator('.desktop-category-navigation')).toHaveCSS(
                        'border-bottom-width',
                        '0px',
                    );
                    const activeCategory = page
                        .locator('.desktop-local-navigation [aria-pressed="true"]')
                        .first();
                    await expect(activeCategory).toHaveCSS('border-bottom-width', '0px');
                    await page.getByRole('button', { name: '日常用品' }).click();
                    if (requestedContent === 'category-banner') {
                        await expect(page.locator('.desktop-catalog-hero.has-image')).toBeVisible();
                    }
                    await expect(page.locator('.desktop-subcategory-sidebar')).toBeVisible();
                    const childCategory = page.locator('.desktop-subcategory-sidebar').getByRole('button', {
                        name: '随行杯',
                        exact: true,
                    });
                    await childCategory.click();
                    await expect(childCategory).toHaveAttribute('aria-pressed', 'true');
                    if (requestedContent === 'category-banner') {
                        await expect(page.locator('.desktop-catalog-hero.has-image')).toHaveCount(0);
                        await expect(page.locator('.desktop-catalog-hero h1')).toContainText('随行杯');
                    }
                }
                if (name === 'category' && width < 1024 && requestedContent === 'category-banner') {
                    await expect(page.locator('.desktop-catalog-hero')).toHaveCount(0);
                }
                if (name === 'category') {
                    await page.getByRole('button', { name: '筛选', exact: true }).click();
                    const sheet = page.getByRole('dialog', { name: '筛选', exact: true });
                    await expect(sheet).toBeVisible();
                    const bounds = await sheet.locator('.price-range-inputs label').evaluateAll(labels =>
                        labels.map(label => {
                            const rect = label.getBoundingClientRect();
                            const input = label.querySelector('input').getBoundingClientRect();
                            return {
                                y: rect.y,
                                height: rect.height,
                                centerDelta: Math.abs(rect.y + rect.height / 2 - input.y - input.height / 2),
                            };
                        }),
                    );
                    expect(bounds).toHaveLength(2);
                    expect(bounds[0].y).toBe(bounds[1].y);
                    for (const bound of bounds) {
                        expect(bound.height).toBe(44);
                        expect(bound.centerDelta).toBeLessThanOrEqual(1);
                    }
                    await sheet.getByRole('button', { name: '100-300', exact: true }).click();
                    await expect(sheet.getByRole('spinbutton', { name: '最低价' })).toHaveValue('100');
                    await expect(sheet.getByRole('spinbutton', { name: '最高价' })).toHaveValue('300');
                    const filterContrast = await page.evaluate(async () => {
                        const result = await window.axe.run(document.querySelector('[role="dialog"]'), {
                            runOnly: ['color-contrast'],
                        });
                        return result.violations.map(violation => ({
                            id: violation.id,
                            nodes: violation.nodes.map(node => node.target),
                        }));
                    });
                    expect(filterContrast, `${preset}/${width} filter dialog contrast`).toEqual([]);
                    await sheet.getByRole('spinbutton', { name: '最低价' }).fill('400');
                    await expect(sheet.locator('.filter-confirm-button')).toBeDisabled();
                    const unchangedUrl = page.url();
                    await page.keyboard.press('Escape');
                    await expect(sheet).toHaveCount(0);
                    expect(page.url()).toBe(unchangedUrl);
                    if (width >= 1024) {
                        await page.getByRole('button', { name: '日常用品', exact: true }).click();
                        const selectedScope = new URL(page.url());
                        expect(selectedScope.searchParams.get('collectionId')).toBeTruthy();
                        await page.getByRole('button', { name: '筛选', exact: true }).click();
                        await sheet.getByRole('button', { name: '100-300', exact: true }).click();
                        await sheet.locator('.filter-confirm-button').click();
                        await expect(page).toHaveURL(/minPrice=100/);
                        await page
                            .locator('.desktop-catalog-actions')
                            .getByRole('button', { name: '重置', exact: true })
                            .click();
                        await expect.poll(() => new URL(page.url()).searchParams.get('minPrice')).toBeNull();
                        for (const key of ['collectionId', 'childId', 'sort', 'term']) {
                            expect(new URL(page.url()).searchParams.get(key)).toBe(
                                selectedScope.searchParams.get(key),
                            );
                        }
                    }
                }
                if (name === 'search-discovery') {
                    await expect(page.locator('.search-discovery')).toBeVisible();
                    if (width >= 1024) {
                        const recent = await page.locator('.search-recent').boundingBox();
                        const suggestions = await page.locator('.popular-searches').boundingBox();
                        expect(recent.x + recent.width).toBeLessThan(suggestions.x);
                    }
                }
                if (name === 'coupons' && requestedContent === 'coupons' && width >= 1024) {
                    await expect(page.locator('.desktop-coupon-ticket')).toHaveCount(4);
                    for (const face of await page.locator('.desktop-coupon-value').all()) {
                        const colors = await face.evaluate(el => ({
                            fg: getComputedStyle(el).color,
                            bg: getComputedStyle(el).backgroundColor,
                        }));
                        expect(textContrast(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5);
                    }
                }
                if (name === 'coupons' && requestedContent === 'coupons' && width < 1024) {
                    const cards = await page.locator('.coupon-activity-card').evaluateAll(elements =>
                        elements.map(card => ({
                            className: card.className,
                            color: getComputedStyle(card).color,
                        })),
                    );
                    expect(new Set(cards.map(card => card.color)).size, JSON.stringify(cards)).toBe(4);
                }
                if (name === 'services') {
                    const slot = page.locator('.business-services-page .category-client-plugin-slot');
                    await expect(slot).toBeVisible();
                    const cards = slot.locator('.category-client-plugin');
                    await expect(cards).toHaveCount(5);
                    await expect(cards.first()).toContainText('2FA 动态码');
                    await expect(cards.last()).toContainText('选购遇到问题？');
                    const moduleLayout = await slot.evaluate(element => ({
                        display: getComputedStyle(element).display,
                        cards: Array.from(element.querySelectorAll('.category-client-plugin'), card => {
                            const rect = card.getBoundingClientRect();
                            return { left: rect.left, top: rect.top };
                        }),
                    }));
                    await expect(cards.first()).toHaveCSS('border-top-width', '0px');
                    const firstCardBox = await cards.first().boundingBox();
                    expect(
                        firstCardBox?.height,
                        `${preset}/${width}/services touch target`,
                    ).toBeGreaterThanOrEqual(44);
                    if (width >= 1024) {
                        expect(moduleLayout.display, `${preset}/${width}/services layout`).toBe('flex');
                        expect(moduleLayout.cards[0].top).toBeCloseTo(moduleLayout.cards[1].top, 0);
                        expect(moduleLayout.cards[1].top).toBeCloseTo(moduleLayout.cards[2].top, 0);
                        expect(moduleLayout.cards[0].left).toBeLessThan(moduleLayout.cards[1].left);
                        expect(moduleLayout.cards[1].left).toBeLessThan(moduleLayout.cards[2].left);
                        expect(moduleLayout.cards[3].top).toBeGreaterThan(moduleLayout.cards[0].top);
                        expect(moduleLayout.cards[3].top).toBeCloseTo(moduleLayout.cards[4].top, 0);
                    } else {
                        expect(moduleLayout.display, `${preset}/${width}/services layout`).toBe('grid');
                        const firstCard = cards.first();
                        const icon = firstCard.locator('.category-client-plugin-icon');
                        const title = firstCard.locator('.category-client-plugin-copy');
                        const [iconBox, titleBox] = await Promise.all([
                            icon.boundingBox(),
                            title.boundingBox(),
                        ]);
                        expect(
                            iconBox && titleBox && iconBox.x < titleBox.x,
                            `${preset}/${width}/services icon beside text`,
                        ).toBeTruthy();
                    }
                }
                if (name === 'category' && width < 1024) {
                    const mobileCategory = await page.evaluate(() => {
                        const border = selector =>
                            getComputedStyle(document.querySelector(selector)).borderBottomWidth;
                        const search = document.querySelector('.category-topbar > .search-trigger');
                        const categoryStrip = document.querySelector('.primary-category-strip');
                        const sort = document.querySelector('.category-results .sort-bar');
                        const searchRect = search?.getBoundingClientRect();
                        const categoryRect = categoryStrip?.getBoundingClientRect();
                        const categoryStyle = categoryStrip ? getComputedStyle(categoryStrip) : null;
                        const sortRect = sort?.getBoundingClientRect();
                        const title = document.querySelector('.category-product-list .product-row-name');
                        const probe = document.createElement('span');
                        probe.style.color = 'var(--text)';
                        document.body.append(probe);
                        const textColor = getComputedStyle(probe).color;
                        probe.remove();
                        return {
                            navigation: border('.category-navigation-shell'),
                            category: border('.primary-category-switcher'),
                            sort: border('.category-results .sort-bar'),
                            product: border('.category-product-list .product-row'),
                            activeMarker: getComputedStyle(
                                document.querySelector('.sort-bar button.is-active'),
                                '::after',
                            ).display,
                            productTitle: title ? getComputedStyle(title).color : null,
                            textColor,
                            alignment: {
                                searchLeft: searchRect?.left ?? null,
                                searchRight: searchRect ? innerWidth - searchRect.right : null,
                                categoryLeft:
                                    categoryRect && categoryStyle
                                        ? categoryRect.left + Number.parseFloat(categoryStyle.paddingLeft)
                                        : null,
                                categoryRight:
                                    categoryRect && categoryStyle
                                        ? innerWidth -
                                          categoryRect.right +
                                          Number.parseFloat(categoryStyle.paddingRight)
                                        : null,
                                sortLeft: sortRect?.left ?? null,
                                sortRight: sortRect ? innerWidth - sortRect.right : null,
                            },
                        };
                    });
                    expect(mobileCategory, `${preset}/${width}/category mobile surfaces`).toMatchObject({
                        navigation: '0px',
                        category: '0px',
                        sort: '0px',
                        product: '0px',
                        activeMarker: 'none',
                        productTitle: mobileCategory.textColor,
                    });
                    for (const edge of [
                        'searchLeft',
                        'searchRight',
                        'categoryLeft',
                        'categoryRight',
                        'sortLeft',
                        'sortRight',
                    ]) {
                        expect(
                            mobileCategory.alignment[edge],
                            `${preset}/${width}/category ${edge}`,
                        ).toBeCloseTo(16, 0);
                    }
                }
                const commonHeader = page
                    .locator(
                        width < 1024
                            ? '.topbar, .mobile-page-header, .search-header, .mail-query-page .top-nav-inner'
                            : '.proto-header-inner',
                    )
                    .filter({ visible: true })
                    .first();
                if (await commonHeader.count()) {
                    expect(
                        (await commonHeader.boundingBox()).height,
                        `${preset}/${width}/${name} common header height`,
                    ).toBe(width < 1024 ? 52 : 72);
                }
                if (name === 'home' && width < 1024) {
                    const overlay = await page.locator('.hero').evaluate(hero => {
                        const image = hero.querySelector('.hero-rich-backdrop');
                        const copy = hero.querySelector('.hero-rich-content');
                        const action = hero.querySelector('.hero-rich-cta-btn');
                        return {
                            image: image.getBoundingClientRect().toJSON(),
                            title: hero.querySelector('.hero-rich-title').getBoundingClientRect().toJSON(),
                            action: action.getBoundingClientRect().toJSON(),
                            copyBackground: getComputedStyle(copy).backgroundColor,
                            loaded: image.complete && image.naturalWidth > 0,
                        };
                    });
                    expect(overlay.loaded, `${preset}/${width}/home image decoded`).toBe(true);
                    expect(overlay.copyBackground, `${preset}/${width}/home no separate copy panel`).toBe(
                        'rgba(0, 0, 0, 0)',
                    );
                    for (const element of [overlay.title, overlay.action]) {
                        expect(element.left).toBeGreaterThanOrEqual(overlay.image.left);
                        expect(element.top).toBeGreaterThanOrEqual(overlay.image.top);
                        expect(element.right).toBeLessThanOrEqual(overlay.image.right + 1);
                        expect(element.bottom).toBeLessThanOrEqual(overlay.image.bottom - 28);
                    }
                    expect(
                        overlay.action.height,
                        `${preset}/${width}/home touch target`,
                    ).toBeGreaterThanOrEqual(44);
                    for (const selector of [
                        '.home-page .notice-strip',
                        '.home-page .hero',
                        '.home-page .home-trust-bar',
                        '.home-page .quick-grid',
                    ]) {
                        const element = page.locator(selector);
                        if (await element.count()) await expect(element).toHaveCSS('border-top-width', '0px');
                    }
                }
                if (name === 'search' && width < 1024) {
                    for (const selector of [
                        '.search-header',
                        '.search-sort',
                        '.search-results .product-row',
                    ]) {
                        await expect(page.locator(selector).first()).toHaveCSS('border-bottom-width', '0px');
                    }
                }
                if (name === 'product' && requestedContent === 'product-coupon-quantity') {
                    const consent = page.getByRole('button', { name: '仅必要功能' });
                    if (await consent.isVisible()) await consent.click();
                    const coupon = page.locator('.detail-coupon-price');
                    await expect(coupon).toHaveCount(0);
                    const increase = page.getByRole('button', { name: '增加数量' });
                    await increase.click();
                    await expect(coupon).toContainText('2件券后合计');
                    await expect(coupon).toContainText('MYR 54.8');
                    await increase.click();
                    await expect(page.locator('.detail-quantity output')).toHaveText('3');
                    await expect(coupon).toContainText('3件券后合计');
                    await expect(coupon).toContainText('MYR 84.7');
                }
                if (name === 'product') {
                    const summary = page.locator('.detail-summary');
                    await expect(summary.locator(':scope > :first-child')).toHaveJSProperty('tagName', 'H1');
                    await expect(summary.locator(':scope > p')).toHaveCount(0);
                    const titleBounds = await summary.locator('h1').boundingBox();
                    const priceBounds = await summary.locator('.detail-price-line').boundingBox();
                    expect(titleBounds.y + titleBounds.height).toBeLessThanOrEqual(priceBounds.y);
                }
                if (width < 1024 && name === 'product') {
                    const productLayout = await page.evaluate(() => {
                        const root = document.querySelector('.product-detail-page').getBoundingClientRect();
                        const sections = [
                            '.detail-gallery-shell',
                            '.detail-summary',
                            '.detail-options',
                            '.detail-service-bar',
                            '.detail-review-block',
                            '.detail-params',
                            '.detail-description',
                            '.product-section',
                        ];
                        return sections
                            .map(selector => {
                                const rect = document
                                    .querySelector(`.product-detail-page > ${selector}`)
                                    ?.getBoundingClientRect();
                                return rect
                                    ? {
                                          selector,
                                          left: rect.left - root.left,
                                          right: root.right - rect.right,
                                      }
                                    : null;
                            })
                            .filter(Boolean);
                    });
                    expect(
                        productLayout.length,
                        `${preset}/${width}/product sections`,
                    ).toBeGreaterThanOrEqual(7);
                    for (const section of productLayout) {
                        if (section.selector === '.detail-gallery-shell') {
                            expect(section.left).toBe(0);
                            expect(section.right).toBe(0);
                            const gallery = page.locator('.detail-gallery');
                            const bounds = await gallery.boundingBox();
                            expect(bounds.width).toBe(width);
                            expect(bounds.height).toBe(width);
                            await expect(gallery).toHaveCSS('border-radius', '0px');
                            continue;
                        }
                        expect(
                            section.left,
                            `${preset}/${width}/${section.selector} left gutter`,
                        ).toBeGreaterThanOrEqual(15);
                        expect(
                            Math.abs(section.left - section.right),
                            `${preset}/${width}/${section.selector} balanced gutters`,
                        ).toBeLessThanOrEqual(1);
                    }
                    for (const selector of [
                        '.detail-summary',
                        '.detail-options',
                        '.detail-description',
                        '.detail-service-bar',
                        '.detail-params dl > div',
                        '.detail-action-bar',
                    ]) {
                        await expect(page.locator(selector).first()).toHaveCSS('border-top-width', '0px');
                    }
                    if (requestedContent === 'product-detail') {
                        await expect(page.locator('.detail-rich-text td').first()).toHaveCSS(
                            'border-top-width',
                            '0px',
                        );
                    }
                }
                if (width < 1024 && name === 'cart') {
                    for (const selector of [
                        '.cart-group',
                        '.cart-group > header',
                        '.cart-line-swipe',
                        '.cart-checkout-bar',
                    ]) {
                        await expect(page.locator(selector).first()).toHaveCSS('border-bottom-width', '0px');
                    }
                    const couponRow = page.locator('.cart-page > .coupon-row');
                    if (await couponRow.count()) {
                        await expect(couponRow).toHaveCSS('border-bottom-width', '0px');
                    }
                    await expect(page.locator('.cart-checkout-bar')).toHaveCSS('border-top-width', '0px');
                }
                if (name === 'login' || name === 'register') {
                    await expect(page.locator('.auth-page .auth-hero')).toHaveCSS('position', 'relative');
                    await expect(page.locator('.auth-page .auth-hero')).toHaveCSS('overflow', 'hidden');
                    const darkFallbackHero = page.locator(
                        ".auth-page-has-image:not(.auth-page-managed) .auth-hero[data-image-tone='dark']",
                    );
                    if (await darkFallbackHero.count()) {
                        const copyColors = await darkFallbackHero
                            .locator('.auth-hero-copy')
                            .evaluate(copy => {
                                const copyBackground = getComputedStyle(copy).backgroundColor;
                                return {
                                    background:
                                        copyBackground === 'rgba(0, 0, 0, 0)'
                                            ? getComputedStyle(copy.parentElement).backgroundColor
                                            : copyBackground,
                                    foreground: getComputedStyle(copy.querySelector('h2')).color,
                                };
                            });
                        expect(
                            textContrast(copyColors.foreground, copyColors.background),
                        ).toBeGreaterThanOrEqual(4.5);
                    }
                }
                if (width < 1024 && name === 'account') {
                    await expect(page.locator('.account-page .account-section').first()).toHaveCSS(
                        'border-bottom-width',
                        '0px',
                    );
                    if (requestedContent === 'dense') {
                        for (const selector of [
                            '.account-latest-logistics > button',
                            '.account-recent-purchases article',
                            '.account-recent-purchases article > button',
                        ]) {
                            await expect(page.locator(selector).first()).toHaveCSS('border-top-width', '0px');
                        }
                    }
                }
                if (name === 'account' && requestedContent === 'aftercare') {
                    const identity = page.locator('.account-identity');
                    await expect(identity.locator('.account-identity-assets > button')).toHaveCount(3);
                    await expect(identity).toContainText('欢迎回来');
                    await expect(identity).toContainText('推广中心');
                    await expect(identity.locator('.account-identity-promotion')).toBeVisible();
                    await expect(identity.locator('.account-identity-details p')).toContainText('***@');
                    await expect(identity.locator('.account-identity-card')).toHaveCSS(
                        'background-image',
                        'linear-gradient(120deg, rgb(23, 51, 73), rgb(40, 83, 105))',
                    );
                    await expect(identity.locator('.account-identity-promotion')).toHaveCSS(
                        'background-color',
                        'rgb(246, 237, 218)',
                    );
                    const box = await identity.boundingBox();
                    expect(box.x).toBeGreaterThanOrEqual(0);
                    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
                    await expect(page.locator('.account-hero-art')).toHaveCount(0);
                }
                if (name === 'support' && requestedContent === 'support') {
                    for (const selector of [
                        '.support-hours-card',
                        '.support-hours-note',
                        '.support-channel-list',
                        '.support-channel-row',
                        '.support-faq-card',
                        '.support-evaluation-card',
                        '.support-tag-btn',
                        '.support-evaluation-textarea',
                    ]) {
                        await expect(page.locator(selector).first()).toHaveCSS('border-top-width', '0px');
                    }
                    await page.locator('.support-tag-btn').first().click();
                    await expect(page.locator('.support-faq-item')).toHaveCount(8);
                    await expect(
                        page
                            .getByRole('navigation', { name: '常见问题分页' })
                            .getByRole('button', { name: '下一页' }),
                    ).toBeDisabled();
                    await expect(page.getByRole('navigation', { name: '常见问题分页' })).toContainText(
                        '1 / 1',
                    );
                    await expect(page.locator('.support-tag-btn').first()).toHaveClass(/is-active/);
                    await page
                        .getByRole('searchbox', { name: '搜索常见问题' })
                        .fill('不可能匹配的测试关键词');
                    await expect(page.locator('.support-faq-item')).toHaveCount(0);
                    await page.getByRole('searchbox', { name: '搜索常见问题' }).fill('运费');
                    await expect(page.locator('.support-faq-item')).toHaveCount(1);
                    await page.getByRole('searchbox', { name: '搜索常见问题' }).fill('');
                    await page.locator('.support-faq-item summary').first().click();
                    await expect(page.locator('.support-faq-item p').first()).toBeVisible();
                }
                if (name === 'notifications' && requestedContent === 'dense') {
                    const notificationList = page.locator('.notification-list');
                    const firstNotification = notificationList.locator(':scope > button').first();
                    await expect(firstNotification).toBeVisible();
                    await expect(notificationList).toHaveCSS('display', 'grid');
                    await expect(firstNotification).toHaveCSS('display', 'grid');
                    await expect(firstNotification.locator('.notification-icon')).toHaveCSS('width', '42px');
                    const detailFits = await firstNotification
                        .locator('small')
                        .evaluate(element => element.scrollWidth <= element.clientWidth + 1);
                    expect(detailFits, `${preset}/${width}/notifications order reference fits`).toBe(true);
                }
                if (name === 'cart' && requestedContent === 'coupons' && width >= 1024) {
                    await page.locator('.cart-summary-panel .coupon-row').click();
                    const sheet = page.locator('.coupon-selector-sheet');
                    await expect(sheet.locator('.desktop-coupon-ticket')).toHaveCount(4);
                    await expect(sheet.locator('.is-selected')).toHaveCount(1);
                    await expect(sheet.locator('.is-unavailable')).toHaveCount(1);
                    await page.screenshot({
                        path: `${output}/${preset}-${width}-coupon-picker.png`,
                        fullPage: true,
                    });
                    await page.keyboard.press('Escape');
                }
                if (name === 'reviews' && requestedContent === 'reviews') {
                    await expect(page.locator('.review-center-pending > header > span')).toHaveText('14');
                    await expect(page.locator('.review-candidate-row')).toHaveCount(4);
                    await expect(page.locator('.review-candidate-row').first().locator('img')).toBeVisible();
                    await expect(page.locator('.review-candidate-more')).toBeVisible();
                }
                if (name === 'notifications' && requestedContent === 'notifications') {
                    await expect(page.locator('.notification-list > button')).toHaveCount(5);
                    await expect(page.locator('.notification-list > button.is-unread')).toHaveCount(4);
                    await expect(
                        page.locator('.notification-toolbar button[aria-pressed="true"]'),
                    ).toHaveText('全部消息');
                }
                if (['purchase', 'checkout'].includes(name) && requestedContent === 'normal') {
                    const sections = await page
                        .locator('.desktop-checkout-main')
                        .evaluate(main =>
                            ['.checkout-address-section', '.checkout-product-group', '.checkout-options'].map(
                                selector => main.querySelector(selector)?.getBoundingClientRect().top ?? -1,
                            ),
                        );
                    expect(sections.every(top => top >= 0 && top < 3000)).toBe(true);
                    expect(sections[0]).toBeLessThan(sections[1]);
                    expect(sections[1]).toBeLessThan(sections[2]);
                    await expect(
                        page.locator('.desktop-checkout-summary .price-summary-coupon'),
                    ).toBeVisible();
                }
                if (width < 1024 && name === 'checkout') {
                    await expect(page.locator('.checkout-options > button').first()).toHaveCSS(
                        'border-top-width',
                        '0px',
                    );
                    await expect(page.locator('.price-summary .summary-total')).toHaveCSS(
                        'border-top-width',
                        '0px',
                    );
                    await expect(page.locator('.submit-order-bar')).toHaveCSS('border-top-width', '0px');
                }
                if (width < 1024 && name === 'orders') {
                    await expect(page.locator('.orders-page .order-tabs')).toHaveCSS(
                        'border-bottom-width',
                        '0px',
                    );
                    await expect(page.locator('.orders-page .order-tabs button.is-active')).toHaveCSS(
                        'border-bottom-width',
                        '0px',
                    );
                }
                if (width < 1024 && name === 'addresses') {
                    await expect(page.locator('.addresses-page .address-type-tabs')).toHaveCSS(
                        'border-top-width',
                        '0px',
                    );
                }
                if (
                    requestedWidth ||
                    (width === 1440 &&
                        [
                            'home',
                            'category',
                            'product',
                            'cart',
                            'checkout',
                            'purchase',
                            'account',
                            'login',
                            'services',
                            'search',
                            'support',
                            'image-studio',
                            'two-factor',
                            'mail-query',
                            'reviews',
                            'legal',
                            'notifications',
                        ].includes(name)) ||
                    (requestedContent === 'product-detail' && name === 'product') ||
                    ([
                        'coupons',
                        'search-discovery',
                        'order-detail',
                        'orders',
                        'account-security',
                        'favorites',
                        'history',
                    ].includes(name) &&
                        [390, 1440].includes(width)) ||
                    (width === 390 &&
                        [
                            'home',
                            'category',
                            'search',
                            'product',
                            'cart',
                            'checkout',
                            'purchase',
                            'orders',
                            'account',
                            'addresses',
                            'login',
                            'services',
                            'support',
                            'two-factor',
                            'mail-query',
                            'reviews',
                            'legal',
                            'notifications',
                        ].includes(name))
                ) {
                    await page.screenshot({
                        path: `${output}/${preset}-${width}-${name}.png`,
                        fullPage: true,
                        animations: 'disabled',
                    });
                }
                if (name === 'reviews' && requestedContent === 'reviews') {
                    await page.locator('.review-candidate-more').click();
                    await expect(page.locator('.review-candidate-row')).toHaveCount(14);
                    await page.locator('.review-candidate-row').last().click();
                    await expect(page.locator('.review-composer')).toBeInViewport();
                    const anonymousOption = page.locator('.review-anonymous-option input[type="checkbox"]');
                    await expect(anonymousOption).not.toBeChecked();
                    await anonymousOption.check();
                    await expect(anonymousOption).toBeChecked();
                    if (width < 1024) {
                        const composerTop = await page
                            .locator('.review-composer')
                            .evaluate(element => element.getBoundingClientRect().top);
                        expect(
                            composerTop,
                            `${preset}/${width}/reviews composer below header`,
                        ).toBeGreaterThanOrEqual(52);
                    }
                }
                if (name === 'notifications' && requestedContent === 'notifications') {
                    await page.getByRole('button', { name: /未读消息/ }).click();
                    await expect(page.locator('.notification-list > button')).toHaveCount(4);
                    await page.getByRole('button', { name: '全部标为已读' }).click();
                    await expect(page.locator('.notification-list > button')).toHaveCount(0);
                    await expect(page.locator('.notification-empty-filter')).toBeVisible();
                }
                if (name === 'legal') {
                    const documentButtons = page.locator('.legal-document-navigation button');
                    await expect(documentButtons).toHaveCount(2);
                    await expect(documentButtons.first()).toHaveAttribute('aria-current', 'page');
                    await documentButtons.last().click();
                    await expect(page).toHaveURL(/\/legal\?id=terms$/u);
                    await expect(documentButtons.last()).toHaveAttribute('aria-current', 'page');
                }
                await page.keyboard.press('Tab');
                const keyboardFocus = await page.evaluate(() => {
                    const active = document.activeElement;
                    if (!(active instanceof HTMLElement) || active === document.body) return null;
                    const style = getComputedStyle(active);
                    const bounds = active.getBoundingClientRect();
                    return {
                        tag: active.tagName.toLowerCase(),
                        className: active.className,
                        visible:
                            bounds.width > 0 &&
                            bounds.height > 0 &&
                            bounds.bottom > 0 &&
                            bounds.right > 0 &&
                            bounds.top < window.innerHeight &&
                            bounds.left < window.innerWidth,
                        indicator:
                            (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2) ||
                            style.boxShadow !== 'none',
                    };
                });
                expect(keyboardFocus, `${preset}/${width}/${name} keyboard focus target`).not.toBeNull();
                expect(keyboardFocus?.visible, `${preset}/${width}/${name} keyboard focus visibility`).toBe(
                    true,
                );
                expect(keyboardFocus?.indicator, `${preset}/${width}/${name} keyboard focus indicator`).toBe(
                    true,
                );
                // Move beyond the skip link before checking a normal component hover state.
                await page.keyboard.press('Tab');
                const hoverTarget = page
                    .locator('main button:not([disabled]):visible, main a[href]:visible')
                    .first();
                if ((await hoverTarget.count()) > 0) await hoverTarget.hover();
                const accessibility = await page.evaluate(async () => {
                    const result = await window.axe.run(document, { runOnly: ['color-contrast'] });
                    return result.violations.map(violation => ({
                        id: violation.id,
                        impact: violation.impact,
                        nodes: violation.nodes.map(node => ({
                            target: node.target,
                            html: node.html,
                            summary: node.failureSummary,
                        })),
                    }));
                });
                for (const violation of accessibility) {
                    for (const node of violation.nodes) {
                        contrastFailures.push(
                            `${preset}/${width}/${name}: ${node.target.join(' ')} — ${node.summary}`,
                        );
                    }
                }
                let primaryContrast;
                if (name === 'home' && (width === 390 || width === 1440)) {
                    const primary = page.locator('.hero-rich-cta-btn');
                    await expect(primary, `${preset}/${width} home primary action`).toBeVisible();
                    await page.mouse.move(0, 0);
                    primaryContrast = {};
                    for (const state of ['default', 'hover']) {
                        if (state === 'hover') await primary.hover();
                        const colors = await primary.evaluate(element => {
                            const style = getComputedStyle(element);
                            return {
                                foreground: style.color,
                                background: style.backgroundColor,
                                backgroundImage: style.backgroundImage,
                            };
                        });
                        expect(
                            colors.backgroundImage,
                            `${preset}/${width} home primary ${state} solid surface`,
                        ).toBe('none');
                        primaryContrast[state] = textContrast(colors.foreground, colors.background);
                        expect(
                            primaryContrast[state],
                            `${preset}/${width} home primary ${state} text contrast`,
                        ).toBeGreaterThanOrEqual(4.5);
                    }
                }
                if (
                    requestedContent === 'saved-products' &&
                    width >= 1024 &&
                    ['favorites', 'history'].includes(name)
                ) {
                    const toolbar = await page.locator('.desktop-account-workbench-toolbar').boundingBox();
                    const rail = await page.locator('.desktop-account-navigation').boundingBox();
                    expect(
                        Math.abs(toolbar.y - rail.y),
                        `${name} content aligned with account rail`,
                    ).toBeLessThanOrEqual(1);
                }
                if (requestedContent === 'saved-products' && width >= 1024 && name === 'favorites') {
                    await page.getByRole('button', { name: '批量管理', exact: true }).click();
                    await page.getByRole('checkbox', { name: '选择 日常随行杯', exact: true }).check();
                    await page.getByRole('button', { name: '取消所选收藏', exact: true }).click();
                    await expect(page.locator('.favorites-page .product-card')).toHaveCount(1);
                    await expect(page.locator('.favorites-page')).toContainText('第二件收藏商品');
                    await page.reload();
                    await expect(page.locator('.favorites-page .product-card')).toHaveCount(1);
                }
                if (requestedContent === 'saved-products' && width >= 1024 && name === 'history') {
                    await expect(page.locator('.history-page .product-card')).toHaveCount(2);
                    const periods = page.getByRole('group', { name: '浏览日期' });
                    await periods.getByRole('button', { name: '今天', exact: true }).click();
                    await expect(page.locator('.history-page .product-card')).toHaveCount(1);
                    await periods.getByRole('button', { name: '更早', exact: true }).click();
                    await expect(page.locator('.history-page .product-card')).toHaveCount(1);
                    await expect(page.locator('.history-page')).toContainText('第二件收藏商品');
                    await periods.getByRole('button', { name: '昨天', exact: true }).click();
                    await expect(page.locator('.history-page .product-card')).toHaveCount(0);
                    await periods.getByRole('button', { name: '全部', exact: true }).click();
                    await expect(page.locator('.history-page .product-card')).toHaveCount(2);
                }
                if (
                    requestedContent === 'locale-preferences' &&
                    ['home', 'account', 'services'].includes(name)
                ) {
                    await page.locator('.locale-preferences-trigger:visible').first().click();
                    const preferences = page.locator('.locale-preferences-sheet');
                    await expect(preferences).toBeVisible();
                    await expect(preferences.locator('.locale-preferences-market')).toHaveCount(0);
                    await expect(preferences).not.toContainText(/当前店铺|Current storefront/);
                    await expect(preferences.getByRole('radiogroup')).toHaveCount(2);
                    await preferences.getByRole('radio', { name: 'English', exact: true }).click();
                    await expect(
                        preferences.getByRole('radio', { name: 'English', exact: true }),
                    ).toHaveAttribute('aria-checked', 'true');
                    await preferences.getByRole('radio', { name: '简体中文', exact: true }).click();
                    await expect(
                        preferences.getByRole('button', { name: '保存设置', exact: true }),
                    ).toBeEnabled();
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-${name}-locale-preferences.png`),
                        fullPage: false,
                        animations: 'disabled',
                    });
                    await preferences.getByRole('button', { name: '保存设置', exact: true }).click();
                    await expect(preferences).toHaveCount(0);
                }
                if (requestedContent === 'flash-sale-heading' && ['home', 'flash-sale'].includes(name)) {
                    const flashSale = page.locator('.flash-sale-section');
                    const heading = flashSale.locator('.section-header');
                    const timer = heading.getByRole('timer');
                    await heading.evaluate(element => element.scrollIntoView({ block: 'center' }));
                    await expect(heading.locator('p')).toHaveCount(0);
                    await expect(flashSale).not.toContainText('不应显示的秒杀副标题');
                    await expect(timer).toContainText(/\d{3}/);
                    expect(
                        await heading
                            .locator('h2')
                            .evaluate(element => element.scrollWidth <= element.clientWidth),
                    ).toBe(true);
                    const [headingBox, titleBox, timerBox] = await Promise.all([
                        heading.boundingBox(),
                        heading.locator('h2').boundingBox(),
                        timer.boundingBox(),
                    ]);
                    expect(timerBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
                    expect(
                        Math.abs(titleBox.y + titleBox.height / 2 - timerBox.y - timerBox.height / 2),
                    ).toBeLessThanOrEqual(1);
                    expect(timerBox.x + timerBox.width).toBeLessThanOrEqual(headingBox.x + headingBox.width);
                    if (name === 'flash-sale') {
                        expect(
                            headingBox.x + headingBox.width - timerBox.x - timerBox.width,
                        ).toBeLessThanOrEqual(4);
                    }
                    await heading.screenshot({
                        path: path.join(output, `${preset}-${width}-${name}-flash-heading.png`),
                        animations: 'disabled',
                    });
                }
                if (requestedContent === 'mail-query-surfaces' && name === 'mail-query') {
                    const mailQuery = page.locator('.mail-query-page');
                    for (const selector of [
                        '.top-nav',
                        '.nav-status',
                        '.hero-badge',
                        '.query-card',
                        '.paste-btn',
                        '.faq-section',
                        '.faq-item',
                    ]) {
                        for (const surface of await mailQuery.locator(selector).all()) {
                            await expect(surface).toHaveCSS('border-bottom-width', '0px');
                        }
                    }
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-mail-query-surfaces.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                    await mailQuery.locator('#queryBtn').click();
                    await expect(mailQuery.locator('.toast-msg.error')).toBeVisible();
                    const input = mailQuery.locator('#codeInput');
                    await input.fill('BUY-LOCAL-QA01');
                    await input.focus();
                    await expect(input).not.toHaveCSS('box-shadow', 'none');
                    await input.press('Enter');
                    await expect(mailQuery.locator('.mail-card')).toHaveCount(1);
                    await expect(mailQuery.locator('.otp-banner')).toContainText('123456');
                    for (const selector of ['.result-summary-card', '.mail-card', '.otp-banner']) {
                        await expect(mailQuery.locator(selector)).toHaveCSS('border-top-width', '0px');
                    }
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-mail-query-results.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                }
                if (requestedContent.startsWith('image-studio-') && name === 'image-studio') {
                    const studio = page.locator('.ai-studio-workflow');
                    const create = studio.locator('.ai-studio-create-panel');
                    const history = studio.locator('.ai-studio-history');
                    await expect(create).toBeVisible();
                    await expect(studio.locator('.ai-studio-controls')).toHaveCSS('box-shadow', 'none');
                    await expect(studio.locator('.ai-studio-controls')).toHaveCSS(
                        'background-color',
                        'rgba(0, 0, 0, 0)',
                    );
                    await expect(studio.locator('.ai-studio-hold-amount strong')).toHaveText('MYR 0.3');
                    await expect(studio.locator('.ai-studio-settlement-amount strong')).toHaveText(
                        requestedContent === 'image-studio-records' ? 'MYR 0' : 'MYR 10',
                    );
                    for (const selector of [
                        '.ai-studio-view-tabs',
                        '.ai-studio-composer',
                        '.ai-studio-options',
                        '.ai-studio-checkout',
                        '.ai-studio-option-row',
                        '.ai-studio-settlement-summary',
                        '.ai-studio-settlement',
                    ]) {
                        await expect(studio.locator(selector)).toHaveCSS('border-top-width', '0px');
                    }
                    const generate = studio.getByRole('button', { name: '开始生成', exact: true });
                    if (requestedContent === 'image-studio-records') {
                        await expect(studio.locator('.ai-studio-low-balance')).toBeVisible();
                        await expect(generate).toBeDisabled();
                    }
                    if (width < 1024) {
                        for (const trigger of await studio.locator('.ai-studio-setting-trigger').all()) {
                            await expect(trigger).toHaveCSS('border-left-width', '0px');
                        }
                        await studio.getByRole('button', { name: /生成张数/ }).click();
                        await page
                            .locator('.ai-studio-setting-sheet')
                            .getByRole('radio', { name: '2 张', exact: true })
                            .click();
                    } else {
                        await expect(studio.locator('.ai-studio-model-grid')).toBeHidden();
                        await expect(studio.locator('.ai-studio-option-row')).toBeHidden();
                        await studio.locator('.ai-studio-desktop-quantity select').selectOption('2');
                    }
                    await expect(studio.locator('.ai-studio-hold-amount strong')).toHaveText('MYR 0.6');
                    await studio.locator('.ai-studio-composer h3').click();
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-image-studio-create.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                    await studio.getByRole('tab', { name: '生成记录', exact: true }).click();
                    await expect(create).toBeHidden();
                    await expect(history).toBeVisible();
                    await expect(history).toHaveCSS('box-shadow', 'none');
                    await expect(history).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                    await expect(history.locator('.ai-studio-history-toolbar')).toHaveCSS(
                        'border-top-width',
                        '0px',
                    );
                    if (requestedContent === 'image-studio-records') {
                        await expect(history.locator('.ai-generation-card')).toHaveCount(2);
                        for (const card of await history.locator('.ai-generation-card').all()) {
                            await expect(card).toHaveCSS('border-bottom-width', '0px');
                        }
                        await history.getByRole('tab', { name: '已完成', exact: true }).click();
                        await expect(history.locator('.ai-generation-card')).toHaveCount(1);
                        await expect(history.locator('.ai-generation-card')).toContainText('实付 MYR 0.3');
                        await history.getByRole('tab', { name: '失败', exact: true }).click();
                        await expect(history.locator('.ai-generation-card')).toHaveCount(1);
                        await expect(history.locator('.ai-generation-card')).toContainText('已释放 MYR 0.3');
                        await history.getByRole('tab', { name: '全部', exact: true }).click();
                    } else {
                        await expect(history.locator('.ai-studio-empty h4')).toHaveText('还没有生成记录');
                        await history.getByRole('button', { name: '去创作', exact: true }).click();
                        await expect(create).toBeVisible();
                        await expect(studio.locator('.ai-studio-hold-amount strong')).toHaveText('MYR 0.6');
                        await studio.getByRole('tab', { name: '生成记录', exact: true }).click();
                    }
                    await history.locator('h3').click();
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-image-studio-history.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
                    ).toBe(true);
                }
                if (requestedContent === 'planned-fixes' && name === 'account' && width < 1024) {
                    const services = page.locator('.account-service-grid');
                    await expect(services.locator(':scope > button')).toHaveCount(8);
                    const rows = await services
                        .locator(':scope > button')
                        .evaluateAll(buttons =>
                            buttons.map(button => Math.round(button.getBoundingClientRect().top)),
                        );
                    expect(new Set(rows).size).toBe(2);
                    await services.screenshot({
                        path: path.join(output, `${preset}-${width}-account-eight-services.png`),
                        animations: 'disabled',
                    });
                    await services.getByRole('button', { name: '浏览足迹', exact: true }).click();
                    await expect(page).toHaveURL(/\/history(?:\?|$)/);
                    await expect(page.locator('.history-page')).toBeVisible();
                }
                if (requestedContent === 'planned-fixes' && name === 'two-factor') {
                    const workspace = page.locator('.two-factor-workspace');
                    const query = workspace.locator('.two-factor-query');
                    const accounts = workspace.locator('.two-factor-accounts');
                    const tabs = workspace.locator('.two-factor-view-tabs');
                    await expect(query).toBeVisible();
                    await expect(query.locator('.two-factor-vault')).toHaveCount(0);
                    if (width < 1024) await expect(accounts).toBeHidden();
                    else await expect(accounts).toBeVisible();
                    await query.locator('h2').click();
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-two-factor-query.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                    const quickSecret = query.locator('#storefront-two-factor-secret');
                    await quickSecret.fill('invalid');
                    await query.getByRole('button', { name: '查询动态码', exact: true }).click();
                    await expect(query.locator('[role="alert"]')).toBeVisible();
                    // Public TOTP example and disposable local vault; never a real account or credential.
                    await quickSecret.fill('JBSWY3DPEHPK3PXP');
                    await query.getByRole('button', { name: '查询动态码', exact: true }).click();
                    await expect(query.locator('.two-factor-query-result p')).toHaveText(/^\d{3} \d{3}$/);
                    if (width < 1024)
                        await tabs.getByRole('tab', { name: '已保存账号', exact: true }).click();
                    const vault = accounts.locator('.two-factor-vault');
                    await vault.getByRole('button', { name: '启用加密保存', exact: true }).click();
                    const passphrase = 'Local-QA-only-passphrase-2026';
                    const passwords = vault.locator('input[type="password"]');
                    await passwords.nth(0).fill(passphrase);
                    await passwords.nth(1).fill(passphrase);
                    await vault.locator('button[type="submit"]').click();
                    await expect(vault).toHaveAttribute('data-vault-state', 'unlocked');
                    await expect(accounts.locator('.two-factor-empty')).toBeVisible();
                    await accounts.getByRole('button', { name: '添加账号', exact: true }).click();
                    const form = accounts.locator('.two-factor-account-form');
                    await form.locator('input').nth(0).fill('本地验收示例账号');
                    await form.locator('input').nth(1).fill('JBSWY3DPEHPK3PXP');
                    await form.locator('button[type="submit"]').click();
                    await expect(accounts.locator('.two-factor-account')).toHaveCount(1);
                    await expect(accounts.locator('.two-factor-account-code p')).toHaveText(/^\d{3} \d{3}$/);
                    await accounts.locator('h2').click();
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-two-factor-accounts.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                    await vault.getByRole('button', { name: '立即上锁', exact: true }).click();
                    await expect(vault).toHaveAttribute('data-vault-state', 'locked');
                    await expect(accounts.locator('.two-factor-empty')).toHaveCount(0);
                    await expect(accounts.locator('.two-factor-account')).toHaveCount(0);
                    await expect(accounts).not.toContainText('0 / 100');
                    await expect(accounts.getByRole('button', { name: '添加账号', exact: true })).toHaveCount(
                        0,
                    );
                    await accounts.locator('h2').click();
                    await page.screenshot({
                        path: path.join(output, `${preset}-${width}-two-factor-locked.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                    if (width < 1024) await tabs.getByRole('tab', { name: '快速查询', exact: true }).click();
                    await expect(query).toBeVisible();
                    await expect(query.locator('.two-factor-lock-notice')).toBeVisible();
                    await quickSecret.fill('JBSWY3DPEHPK3PXP');
                    await query.getByRole('button', { name: '查询动态码', exact: true }).click();
                    await expect(query.locator('.two-factor-query-result p')).toHaveText(/^\d{3} \d{3}$/);
                    await expect(query.getByRole('button', { name: '复制', exact: true })).toBeEnabled();
                    await expect(query.getByRole('button', { name: '保存到列表', exact: true })).toHaveCount(
                        0,
                    );
                    await query.getByRole('button', { name: '去解锁', exact: true }).click();
                    await expect(vault.locator('input[type="password"]')).toBeFocused();
                    await vault.locator('input[type="password"]').fill(passphrase);
                    await vault.getByRole('button', { name: '解锁账号', exact: true }).click();
                    await expect(vault).toHaveAttribute('data-vault-state', 'unlocked');
                    await expect(accounts.locator('.two-factor-account')).toHaveCount(1);
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
                    ).toBe(true);
                }
                results.push({
                    preset,
                    width,
                    name,
                    geometry,
                    keyboardFocus,
                    accessibility,
                    primaryContrast,
                });

                if (name === 'category' && width >= 1024) {
                    await page.locator('.proto-search-open').click();
                    await expect(page).toHaveURL(/\/search$/);
                    await expect(page.locator('.search-page .search-discovery')).toBeVisible();
                    await expect(page.locator('.search-page .search-header input')).toBeFocused();
                }

                if (name === 'home' && width >= 1024) {
                    const tools = page.locator('.quick-grid > button');
                    await expect(tools).toHaveCount(5);
                    await expect(page.locator('.quick-grid h2')).toContainText('快捷入口');
                    await expect(page.locator('.desktop-quick-pagination')).toHaveCount(0);
                    await expect(tools.filter({ hasText: '商品分类' })).toBeVisible();
                    await expect(tools.filter({ hasText: '优惠中心' })).toBeVisible();
                    const pair = await page
                        .locator('.home-intro-grid')
                        .first()
                        .evaluate(root => {
                            const hero = root.querySelector('.hero');
                            const quick = root.querySelector('.quick-grid');
                            const copy = hero?.querySelector('.hero-rich-content');
                            const image = hero?.querySelector('.hero-rich-backdrop');
                            if (!hero || !quick || !copy) return null;
                            const heroBounds = hero.getBoundingClientRect();
                            const quickBounds = quick.getBoundingClientRect();
                            return {
                                heroHeight: heroBounds.height,
                                heroWidth: heroBounds.width,
                                heroRight: heroBounds.right,
                                heroBottom: heroBounds.bottom,
                                quickHeight: quickBounds.height,
                                quickWidth: quickBounds.width,
                                quickLeft: quickBounds.left,
                                quickTop: quickBounds.top,
                                copyBackground: getComputedStyle(copy).backgroundColor,
                                imageFit: image ? getComputedStyle(image).objectFit : null,
                                imageRatio:
                                    image instanceof HTMLImageElement && image.naturalHeight > 0
                                        ? image.naturalWidth / image.naturalHeight
                                        : null,
                            };
                        });
                    expect(pair, `${preset}/${width}/home has the paired hero`).not.toBeNull();
                    expect(pair.copyBackground, `${preset}/${width}/home copy has no card`).toBe(
                        'rgba(0, 0, 0, 0)',
                    );
                    if (width >= 1400) {
                        expect(
                            Math.abs(pair.heroWidth / pair.quickWidth - 2),
                            `${preset}/${width}/home 8:4 column ratio`,
                        ).toBeLessThan(0.01);
                        expect(
                            pair.heroRight,
                            `${preset}/${width}/home approved 8:4 layout`,
                        ).toBeLessThanOrEqual(pair.quickLeft);
                        expect(
                            Math.abs(pair.heroHeight - pair.quickHeight),
                            `${preset}/${width}/home equal height`,
                        ).toBeLessThanOrEqual(2);
                    } else {
                        expect(
                            pair.quickTop,
                            `${preset}/${width}/home narrow desktop stacks`,
                        ).toBeGreaterThanOrEqual(pair.heroBottom);
                    }
                    if (requestedContent === 'wide-hero') {
                        expect(pair.imageRatio, `${preset}/${width}/home image decoded`).not.toBeNull();
                        expect(
                            pair.imageFit,
                            `${preset}/${width}/home preserves the complete artwork inside the shared frame`,
                        ).toBe('contain');
                    }
                }

                if (name === 'home' && width === 1440) {
                    await page.evaluate(() => window.scrollTo(0, 320));
                    await expect
                        .poll(() =>
                            page.evaluate(
                                () =>
                                    document.querySelector('.proto-desktop-header')?.getBoundingClientRect()
                                        .top,
                            ),
                        )
                        .toBe(0);
                }
                if (name === 'services' && (width === 390 || width === 1440)) {
                    await page.locator('.business-services-page .category-client-plugin-two-factor').click();
                    await expect(page).toHaveURL(/\/two-factor(?:\?|$)/);
                }
                if (verifyProductNavigation) {
                    if (name === 'category' && width >= 1024) {
                        await page.goto(`${baseUrl}${route}`);
                    }
                    const consent = page.getByRole('button', { name: '仅必要功能' });
                    if (await consent.isVisible()) await consent.click();
                    if (name === 'category' && width < 1024) {
                        const strip = page.locator('.primary-category-strip');
                        await expect(strip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                        await expect(strip).toHaveCSS('box-shadow', 'none');
                        await expect(page.locator('.primary-category-switcher')).toHaveCSS(
                            'padding-top',
                            '12px',
                        );
                        await expect(page.locator('.primary-category-switcher')).toHaveCSS(
                            'padding-bottom',
                            '12px',
                        );
                    }
                    const entry = page.locator('.product-card, .product-row').first();
                    await expect(entry, `${preset}/${width}/${name} has products`).toBeVisible();
                    const title = await entry.locator('.product-card-name, .product-row-name').textContent();
                    const media = entry.locator('.product-card-media, .product-row-image');
                    await media.scrollIntoViewIfNeeded();
                    const hit = await media.evaluate(element => {
                        const rect = element.getBoundingClientRect();
                        const x = rect.x + rect.width / 2;
                        const y = rect.y + rect.height / 2;
                        return {
                            x,
                            y,
                            target: document.elementFromPoint(x, y)?.outerHTML.slice(0, 180),
                            detailTarget: document
                                .elementFromPoint(x, y)
                                ?.matches('.product-card-detail-link, .product-row-detail-link'),
                        };
                    });
                    expect(
                        hit.detailTarget,
                        `${preset}/${width}/${name} image reaches detail action: ${hit.target}`,
                    ).toBe(true);
                    await page.mouse.click(hit.x, hit.y);
                    await expect(page).toHaveURL(/\/product\?id=product-1(?:&|$)/);
                    await expect(
                        page.getByRole('heading', { name: title, exact: true }).first(),
                    ).toBeVisible();
                }
            }
            expect(errors).toEqual([]);
            await page.close();
        }
    }
    expect(contrastFailures, 'skin and route contrast').toEqual([]);
    const previewPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await previewPage.route('**/*', route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        if (url.pathname.includes('shop-api')) {
            return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ data: fixtureData('modern-oriental', false) }),
            });
        }
        if (url.pathname.includes('/storefront-realtime')) return route.fulfill({ status: 204, body: '' });
        return route.continue();
    });
    await previewPage.goto(`${baseUrl}/__storefront-preview?viewport=1440`);
    await expect(
        previewPage
            .frameLocator('iframe')
            .locator("[data-page-readiness='ready'], [data-page-readiness='degraded']"),
    ).toBeAttached({ timeout: 15000 });
    await previewPage.getByLabel('路由（36）').selectOption('services');
    await expect(previewPage.getByLabel('路由（36）')).toHaveValue('services');
    await expect(previewPage.frameLocator('iframe').locator('.business-services-page')).toBeVisible({
        timeout: 15000,
    });
    for (const preset of ['classic', 'modern-oriental', 'neo-minimalist']) {
        await previewPage.getByLabel('皮肤').selectOption(preset);
        await expect(previewPage.locator('iframe')).toHaveAttribute(
            'src',
            new RegExp(`storefrontPreviewPreset=${preset}`),
            { timeout: 15000 },
        );
        await expect(previewPage.frameLocator('iframe').locator('html')).toHaveAttribute(
            'data-storefront-preset',
            preset,
            { timeout: 15000 },
        );
        await expect(previewPage.frameLocator('iframe').locator('.business-services-page')).toBeVisible();
    }
    await previewPage.close();
    await writeFile(
        `${output}/storefront-result.json`,
        JSON.stringify({ passed: true, mockedShopApi: true, routes: routes.length, results }, null, 2),
    );
    process.stdout.write(
        `Storefront visual checks passed: ${results.length} route/skin/viewport combinations and live preview switching\n`,
    );
} finally {
    await browser.close();
}
