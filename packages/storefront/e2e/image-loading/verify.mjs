import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

import { fixtureData } from '../cart-commands/fixtures.mjs';

const origin = process.env.STOREFRONT_PREVIEW_ORIGIN ?? 'http://127.0.0.1:5198';
const imagePath = '/assets/preview/image-loading-fixture__preview.png';
const nextHeroImagePath = '/assets/preview/image-loading-next-hero__preview.png';
const fixture = structuredClone(fixtureData('classic', false));
fixture.storefrontContent[0].backgroundColor = '#F6F2EA';
fixture.storefrontContent[0].textColor = '#203346';
fixture.storefrontContent = [
    { ...fixture.storefrontContent[0], imageUrl: `${origin}${imagePath}` },
    {
        ...fixture.storefrontContent[0],
        id: 'image-loading-next-hero',
        code: 'image-loading-next-hero',
        position: fixture.storefrontContent[0].position + 1,
        imageUrl: `${origin}${nextHeroImagePath}`,
    },
    {
        ...fixture.storefrontContent[0],
        id: 'auth-login',
        code: 'auth-login',
        type: 'AUTH_LOGIN',
        imageUrl: `${origin}${imagePath}`,
        title: '欢迎回来',
    },
    {
        ...fixture.storefrontContent[0],
        id: 'auth-register',
        code: 'auth-register',
        type: 'AUTH_REGISTER',
        imageUrl: `${origin}${imagePath}`,
        title: '创建账户',
    },
];
const image =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700">' +
    '<rect width="1200" height="700" fill="#ffffff"/></svg>';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const width of [390, 1440]) {
        for (const pageName of ['/', '/login', '/register']) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const imageRequests = [];
            const errors = [];
            let firstHeroFinishedAt = null;
            let nextHeroStartedAt = null;
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => {
                const url = new URL(request.url());
                if (
                    url.pathname === nextHeroImagePath &&
                    url.searchParams.get('preset')?.startsWith('storefront-hero-')
                ) {
                    nextHeroStartedAt = Date.now();
                }
            });
            page.on('requestfinished', request => {
                const url = new URL(request.url());
                if (
                    url.pathname === imagePath &&
                    url.searchParams.get('preset')?.startsWith('storefront-hero-')
                ) {
                    firstHeroFinishedAt = Date.now();
                }
            });
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.pathname.includes('shop-api')) {
                    return route.fulfill({ json: { data: fixture } });
                }
                if (url.pathname === imagePath || url.pathname === nextHeroImagePath) {
                    imageRequests.push(url.toString());
                    if (
                        url.pathname === imagePath &&
                        url.searchParams.get('preset')?.startsWith('storefront-hero-')
                    ) {
                        await new Promise(resolve => setTimeout(resolve, 250));
                    }
                    return route.fulfill({ contentType: 'image/svg+xml', body: image });
                }
                if (url.pathname.includes('storefront-realtime')) {
                    return route.fulfill({ status: 204, body: '' });
                }
                if (url.origin !== origin) return route.abort();
                return route.continue();
            });
            await page.goto(`${origin}${pageName}`);
            const authPage = pageName !== '/';
            if (authPage && width < 1024) {
                await page.locator('.auth-page').waitFor({ state: 'attached' });
                await page.waitForTimeout(200);
                assert.equal(await page.locator('.auth-hero img.safe-image').count(), 0);
                assert.deepEqual(imageRequests, [], `${width} ${pageName}: hidden artwork must not download`);
                assert.deepEqual(errors, [], `${width} ${pageName}: browser errors`);
                if (pageName === '/login') {
                    await page.setViewportSize({ width: 1440, height: 900 });
                    await page.locator('.auth-hero img.safe-image').waitFor({ state: 'visible' });
                    await page.waitForFunction(() => {
                        const imageElement = document.querySelector('.auth-hero img.safe-image');
                        return (
                            imageElement instanceof HTMLImageElement &&
                            imageElement.complete &&
                            imageElement.naturalWidth > 0
                        );
                    });
                    assert.equal(imageRequests.length, 1, 'expanding to desktop loads the artwork once');
                    await page.setViewportSize({ width, height: 900 });
                    await page.locator('.auth-hero img.safe-image').waitFor({ state: 'detached' });
                }
                results.push({
                    width,
                    pageName,
                    initialImageRequests: [],
                    ...(pageName === '/login' ? { desktopResizeRequests: [...imageRequests] } : {}),
                });
                await page.close();
                continue;
            }
            const selector = authPage ? '.auth-hero img.safe-image' : '.hero-scene-wrapper img';
            await page.locator(selector).first().waitFor({ state: 'attached', timeout: 10000 });
            await page.waitForFunction(target => {
                const element = document.querySelector(target);
                return element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0;
            }, selector);
            await page.waitForTimeout(100);
            assert.deepEqual(errors, [], `${width} ${pageName}: browser errors`);
            assert.ok(imageRequests.length >= 1, `${width} ${pageName}: managed image requested`);
            assert.ok(
                imageRequests.every(request => new URL(request).searchParams.has('preset')),
                `${width} ${pageName}: original image must not download separately: ${imageRequests}`,
            );
            if (authPage) {
                assert.ok(
                    imageRequests.every(request =>
                        new URL(request).searchParams.get('preset')?.startsWith('storefront-detail-'),
                    ),
                    `${width} ${pageName}: authentication uses responsive detail images: ${imageRequests}`,
                );
                await page
                    .locator('.auth-hero[data-image-contrast="direct"]')
                    .waitFor({ state: 'attached', timeout: 5000 });
            } else {
                assert.ok(firstHeroFinishedAt !== null, `${width}: visible hero did not finish loading`);
                assert.ok(nextHeroStartedAt !== null, `${width}: next hero was not prepared`);
                assert.ok(
                    nextHeroStartedAt >= firstHeroFinishedAt,
                    `${width}: next hero must wait until the visible hero has finished loading`,
                );
                const heroLayout = await page
                    .locator('.home-page .hero')
                    .first()
                    .evaluate(hero => {
                        const imageElement = hero.querySelector('.hero-rich-image-link');
                        const copy = hero.querySelector('.hero-rich-content');
                        const navigation = hero.querySelector('.desktop-hero-navigation');
                        const title = hero.querySelector('.hero-rich-title');
                        if (!imageElement || !copy) return null;
                        const imageBounds = imageElement.getBoundingClientRect();
                        const copyBounds = copy.getBoundingClientRect();
                        const navigationBounds = navigation?.getBoundingClientRect();
                        return {
                            imageBottom: imageBounds.bottom,
                            imageLeft: imageBounds.left,
                            imageRight: imageBounds.right,
                            copyTop: copyBounds.top,
                            copyBottom: copyBounds.bottom,
                            copyRight: copyBounds.right,
                            copyBackground: getComputedStyle(copy).backgroundColor,
                            overlayBackground: getComputedStyle(imageElement, '::after').backgroundImage,
                            titleColor: title ? getComputedStyle(title).color : null,
                            navigationLeft: navigationBounds?.left ?? null,
                            navigationBottom: navigationBounds?.bottom ?? null,
                        };
                    });
                assert.ok(heroLayout, `${width}: home hero layout is present`);
                if (width >= 1200) {
                    assert.equal(heroLayout.copyBackground, 'rgba(0, 0, 0, 0)', `${width}: copy has no card`);
                    assert.ok(
                        heroLayout.overlayBackground.includes('rgba(246, 242, 234, 0.86)'),
                        `${width}: image overlay uses the same managed light palette as dark text`,
                    );
                    assert.equal(heroLayout.titleColor, 'rgb(32, 51, 70)');
                    assert.ok(
                        heroLayout.copyTop < heroLayout.imageBottom,
                        `${width}: copy overlays hero image`,
                    );
                    assert.ok(
                        heroLayout.copyBottom <= heroLayout.imageBottom + 1,
                        `${width}: copy stays on artwork`,
                    );
                    assert.ok(heroLayout.navigationLeft !== null, `${width}: navigation is grouped`);
                    assert.ok(
                        heroLayout.navigationLeft > heroLayout.copyRight,
                        `${width}: navigation does not overlap copy`,
                    );
                    assert.ok(
                        heroLayout.navigationBottom <= heroLayout.imageBottom + 1,
                        `${width}: navigation stays on artwork`,
                    );
                } else {
                    assert.ok(
                        heroLayout.copyTop >= heroLayout.imageBottom - 1,
                        `${width}: mobile copy follows image`,
                    );
                }
            }
            results.push({ width, pageName, imageRequests, firstHeroFinishedAt, nextHeroStartedAt });
            await page.close();
        }
    }
} finally {
    await browser.close();
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
