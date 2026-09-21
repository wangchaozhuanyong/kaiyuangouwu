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
                    const viewportWidth = document.documentElement.clientWidth;
                    return {
                        viewport: viewportWidth,
                        scroll: document.documentElement.scrollWidth,
                        frameLeft: frameRect?.left ?? null,
                        frameRight: frameRect ? viewportWidth - frameRect.right : null,
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
                    expect(
                        geometry.frameLeft,
                        `${preset}/${width}/${name} safe gutter`,
                    ).toBeGreaterThanOrEqual(31);
                }
                if (name === 'product' && width >= 1024) {
                    const media = page.locator('.desktop-product-purchase .detail-gallery');
                    await expect(media).toBeVisible();
                    const box = await media.boundingBox();
                    expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThanOrEqual(1);
                    await expect(media.locator('img').first()).toHaveCSS('object-fit', 'contain');
                }
                if (name === 'category' && width >= 1024) {
                    await expect(page.locator('.desktop-category-navigation')).toBeVisible();
                    await expect(page.locator('.desktop-local-navigation')).toBeVisible();
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
                expect(accessibility, `${preset}/${width}/${name} contrast`).toEqual([]);
                results.push({ preset, width, name, geometry, keyboardFocus, accessibility });

                if (
                    width === 1440 &&
                    ['home', 'product', 'checkout', 'account', 'login', 'image-studio', 'legal'].includes(
                        name,
                    )
                ) {
                    await page.screenshot({
                        path: `${output}/${preset}-${width}-${name}.png`,
                        fullPage: true,
                        animations: 'disabled',
                    });
                }
            }
            expect(errors).toEqual([]);
            await page.close();
        }
    }
    await writeFile(
        `${output}/storefront-result.json`,
        JSON.stringify({ passed: true, mockedShopApi: true, routes: routes.length, results }, null, 2),
    );
    process.stdout.write(
        `Storefront visual checks passed: ${results.length} route/skin/viewport combinations\n`,
    );
} finally {
    await browser.close();
}
