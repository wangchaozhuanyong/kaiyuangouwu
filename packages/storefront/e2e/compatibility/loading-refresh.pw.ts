import { expect, test, type Page } from '@playwright/test';

async function authorizeLocalStorefront(page: Page) {
    if (process.env.COMPAT_BASE_URL) return;
    const productionAccessCookie = process.env.COMPAT_STOREFRONT_ENTRY_COOKIE;
    if (!productionAccessCookie) throw new Error('全局初始化应提供推广入口 Cookie');
    await page.context().addCookies([
        {
            name: 'storefront-entry',
            value: productionAccessCookie,
            domain: '127.0.0.1',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        },
    ]);
}

async function isolateRouteLoadingFromShopApi(page: Page) {
    await page.route('**/shop-api?**', async route => {
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ errors: [{ message: 'Route-loading compatibility fixture' }] }),
        });
    });
}

async function holdRouteChunk(page: Page, chunkNames: readonly string[]) {
    let delayed = false;
    let markRequested!: () => void;
    let releaseRequest!: () => void;
    const requested = new Promise<void>(resolve => {
        markRequested = resolve;
    });
    const released = new Promise<void>(resolve => {
        releaseRequest = resolve;
    });

    await page.route(/\/assets\/[^/]+\.js(?:\?.*)?$/u, async route => {
        const fileName = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
        if (!delayed && chunkNames.some(chunkName => fileName.startsWith(`${chunkName}-`))) {
            delayed = true;
            markRequested();
            await released;
        }
        await route.continue();
    });

    return {
        waitUntilRequested: () => requested,
        release: releaseRequest,
    };
}

test('旧公告地址返回首页，不再显示独立公告页面', async ({ page }) => {
    await authorizeLocalStorefront(page);
    await page.goto('/announcements', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/$/u);
    await expect(page.locator('main.home-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: '网站公告' })).toHaveCount(0);
});

test('分类页硬刷新显示中文加载状态并保留筛选参数', async ({ page }) => {
    await authorizeLocalStorefront(page);
    await isolateRouteLoadingFromShopApi(page);
    const delayedChunk = await holdRouteChunk(page, ['category', 'catalog-route-pages', 'category-page']);

    const navigation = page.goto(
        '/category?collectionId=collection-1&childId=child-1&sort=sales&fulfillment=digital&inStockOnly=true',
        { waitUntil: 'domcontentloaded' },
    );
    await delayedChunk.waitUntilRequested();

    const pendingTransition = page.getByRole('status', { name: '正在加载页面', exact: true });
    try {
        await expect(pendingTransition).toBeVisible();
        await expect(pendingTransition).toHaveAttribute('aria-label', '正在加载页面');
        await expect(pendingTransition).toHaveAttribute('aria-busy', 'true');
        await expect(pendingTransition).toHaveAttribute('data-page-pending', 'data');
        await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
    } finally {
        delayedChunk.release();
    }

    await navigation;
    await expect(page.locator('main.category-page, main.desktop-catalog-main')).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get('collectionId')).toBe('collection-1');
    expect(url.searchParams.get('childId')).toBe('child-1');
    expect(url.searchParams.get('sort')).toBe('sales');
    expect(url.searchParams.get('fulfillment')).toBe('digital');
    expect(url.searchParams.get('inStockOnly')).toBe('true');
});

test('目标路由未解析时导航保持当前页高亮', async ({ page }) => {
    await authorizeLocalStorefront(page);
    await isolateRouteLoadingFromShopApi(page);
    await page.goto('/category', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main.category-page, main.desktop-catalog-main')).toBeVisible();
    await page.getByRole('button', { name: '仅必要功能', exact: true }).click();
    const delayedChunk = await holdRouteChunk(page, [
        'services',
        'content-route-pages',
        'business-services-page',
    ]);

    const categoryNavigation = page.locator('nav[aria-label] a[href="/category"]');
    const servicesNavigation = page.locator('nav[aria-label] a[href="/services"]');
    await expect(categoryNavigation).toHaveAttribute('aria-current', 'page');

    await servicesNavigation.click();
    await expect(page).toHaveURL(/\/services(?:\?|$)/u);
    await delayedChunk.waitUntilRequested();
    try {
        await expect(categoryNavigation).toHaveAttribute('aria-current', 'page');
        await expect(servicesNavigation).not.toHaveAttribute('aria-current', 'page');
    } finally {
        delayedChunk.release();
    }

    await expect(page.locator('main.business-services-page')).toBeVisible();
    await expect(servicesNavigation).toHaveAttribute('aria-current', 'page');
});

test('导航意图会同时预取目标页面组件', async ({ page }) => {
    await authorizeLocalStorefront(page);
    await isolateRouteLoadingFromShopApi(page);
    await page.goto('/category', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main.category-page, main.desktop-catalog-main')).toBeVisible();

    await page.getByRole('button', { name: '仅必要功能', exact: true }).click();
    const servicesNavigation = page.locator('nav[aria-label] a[href="/services"]');
    const componentResponse = page.waitForResponse(response => {
        const fileName = new URL(response.url()).pathname.split('/').at(-1) ?? '';
        return fileName.startsWith('business-services-page-') && response.ok();
    });

    await servicesNavigation.hover();
    await componentResponse;
    await servicesNavigation.click();

    await expect(page.locator('main.business-services-page')).toBeVisible();
    await expect(page.locator('.route-transition')).toHaveCount(0);
});

test('懒加载页面样式不会被误判为新版本', async ({ page }) => {
    await authorizeLocalStorefront(page);
    const versionCheck = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/index.html') && url.searchParams.has('__storefront_version');
    });

    await page.goto('/support', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main.subpage')).toBeVisible();
    await versionCheck;

    await expect(page.locator('.storefront-update-prompt')).toHaveCount(0);
});

// Uses the local readiness fixture server; never contacts a production API.
test('首屏图片冷加载与缓存刷新不被解码等待遮住', async ({ page }, testInfo) => {
    test.skip(process.env.COMPAT_MEDIA_FIXTURE !== '1', 'Requires the controlled local media fixture');
    await page.addInitScript(() => {
        // The native method is called below with the image as its explicit receiver.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const original = HTMLImageElement.prototype.decode;
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        Object.assign(window, { __qaReleaseDecode: release, __qaDecodePending: false });
        HTMLImageElement.prototype.decode = async function () {
            await original.call(this);
            if (this.src.includes('qa-readiness-')) {
                Object.assign(window, { __qaDecodePending: true });
                await gate;
            }
        };
    });
    const nonce = `media-${Date.now()}-${testInfo.project.name}`;
    await page.goto(`/?qaMedia=${nonce}`, { waitUntil: 'domcontentloaded' });
    const hero = page.locator('.hero .safe-image-frame').first();
    const picture = hero.locator('img');
    await expect(hero).toBeVisible();
    const before = await hero.boundingBox();
    await expect
        .poll(() =>
            page.evaluate(() =>
                Boolean((window as unknown as { __qaDecodePending: boolean }).__qaDecodePending),
            ),
        )
        .toBe(true);
    await expect(picture).toHaveJSProperty('complete', true);
    await expect(picture).toHaveCSS('opacity', '1');
    await expect(picture).toHaveCSS('z-index', '1');
    await expect(hero).not.toHaveClass(/is-loaded/);
    await page.screenshot({ path: testInfo.outputPath('image-visible-before-decode.png') });
    await page.evaluate(() => (window as unknown as { __qaReleaseDecode: () => void }).__qaReleaseDecode());
    await expect(hero).toHaveClass(/is-loaded/);
    expect(await hero.boundingBox()).toEqual(before);
    const source = await picture.evaluate(image => (image as HTMLImageElement).currentSrc);
    const cold = await page.evaluate(
        url =>
            performance.getEntriesByName(url).map(entry => ({
                transferSize: (entry as PerformanceResourceTiming).transferSize,
                duration: entry.duration,
            })),
        source,
    );
    expect(cold).toHaveLength(1);
    expect(cold[0].transferSize).toBeGreaterThan(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(picture).toHaveJSProperty('complete', true);
    await expect(picture).toHaveCSS('opacity', '1');
    await page.evaluate(() => (window as unknown as { __qaReleaseDecode: () => void }).__qaReleaseDecode());
    await expect(hero).toHaveClass(/is-loaded/);
    const warm = await page.evaluate(
        url =>
            performance.getEntriesByName(url).map(entry => ({
                transferSize: (entry as PerformanceResourceTiming).transferSize,
                duration: entry.duration,
            })),
        source,
    );
    expect(warm).toHaveLength(1);
    expect(warm[0].transferSize).toBe(0);
    await testInfo.attach('image-cache-evidence', {
        body: JSON.stringify({ cold, warm }),
        contentType: 'application/json',
    });
});
