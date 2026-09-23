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
    ['announcements', '/announcements'],
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
                width === 390 || width === 1440
                    ? routes
                    : routes.filter(([name]) => criticalRoutes.has(name));
            const selectedRoutes = requestedRoute
                ? scopedRoutes.filter(([name]) => name === requestedRoute)
                : scopedRoutes;
            const page = await browser.newPage({
                viewport: { width, height: width < 1024 ? 844 : 1000 },
                locale: 'zh-CN',
                reducedMotion: 'reduce',
            });
            const errors = [];
            let signedIn = true;
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                if (url.pathname.includes('shop-api')) {
                    return route.fulfill({
                        contentType: 'application/json',
                        body: JSON.stringify({ data: fixtureData(preset, signedIn) }),
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
                        const sections = [
                            '.proto-hero-section',
                            '.proto-filter-bar',
                            '.proto-product-section',
                        ];
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
                    const descriptionMedia = description.locator('.detail-description-media');
                    await expect(descriptionMedia).toBeVisible();
                    const [descriptionBox, descriptionMediaBox] = await Promise.all([
                        description.boundingBox(),
                        descriptionMedia.boundingBox(),
                    ]);
                    expect(
                        (descriptionMediaBox?.width ?? 0) / (descriptionBox?.width ?? 1),
                        `${preset}/${width}/product description media fill`,
                    ).toBeGreaterThanOrEqual(0.84);
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
                    await expect(page.locator('.desktop-category-navigation')).toBeVisible();
                    await expect(page.locator('.desktop-local-navigation')).toBeVisible();
                    await expect(page.locator('.desktop-category-navigation')).toHaveCSS(
                        'border-bottom-width',
                        '0px',
                    );
                    const activeCategory = page.locator('.desktop-local-navigation [aria-pressed="true"]');
                    await expect(activeCategory).toHaveCSS('border-bottom-width', '0px');
                    await page.getByRole('button', { name: '日常用品' }).click();
                    await expect(page.locator('.desktop-subcategory-sidebar')).toBeVisible();
                    const childCategory = page.locator('.desktop-subcategory-sidebar').getByRole('button', {
                        name: '随行杯',
                        exact: true,
                    });
                    await childCategory.click();
                    await expect(childCategory).toHaveAttribute('aria-pressed', 'true');
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
                if (name === 'home' && width < 1024) {
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
                if (width < 1024 && name === 'product') {
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
                        await expect(darkFallbackHero.locator('.auth-hero-copy h2')).toHaveCSS(
                            'color',
                            'rgb(255, 255, 255)',
                        );
                    }
                }
                if (width < 1024 && name === 'account') {
                    await expect(page.locator('.account-page .account-section').first()).toHaveCSS(
                        'border-bottom-width',
                        '0px',
                    );
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
                    (width === 1440 &&
                        [
                            'home',
                            'category',
                            'product',
                            'checkout',
                            'account',
                            'login',
                            'services',
                            'image-studio',
                            'two-factor',
                            'reviews',
                            'legal',
                        ].includes(name)) ||
                    (width === 390 &&
                        [
                            'home',
                            'category',
                            'search',
                            'product',
                            'cart',
                            'checkout',
                            'orders',
                            'account',
                            'addresses',
                            'login',
                            'services',
                            'support',
                            'two-factor',
                            'reviews',
                            'legal',
                        ].includes(name))
                ) {
                    await page.screenshot({
                        path: `${output}/${preset}-${width}-${name}.png`,
                        fullPage: true,
                        animations: 'disabled',
                    });
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
                    const primary = page.locator(width >= 1024 ? '.proto-btn-upgrade' : '.hero-rich-cta-btn');
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
                results.push({
                    preset,
                    width,
                    name,
                    geometry,
                    keyboardFocus,
                    accessibility,
                    primaryContrast,
                });

                if (name === 'home' && width >= 1024) {
                    const tools = page.locator('.proto-tool-item');
                    await expect(tools).toHaveCount(3);
                    await expect(page.getByLabel('下一组快捷入口')).toBeVisible();
                    await expect(tools.filter({ hasText: '商品分类' })).toBeVisible();
                    await page.getByLabel('下一组快捷入口').click();
                    await expect(tools).toHaveCount(2);
                    await expect(tools.filter({ hasText: '优惠中心' })).toBeVisible();
                    await expect(page.locator('.proto-tools-pagination')).toContainText('2 / 2');
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
