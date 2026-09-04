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

test('分类页硬刷新显示中文品牌过渡并保留筛选参数', async ({ page }) => {
    await authorizeLocalStorefront(page);
    await isolateRouteLoadingFromShopApi(page);
    const delayedChunk = await holdRouteChunk(page, ['category', 'catalog-route-pages', 'category-page']);

    const navigation = page.goto(
        '/category?collectionId=collection-1&childId=child-1&sort=sales&fulfillment=digital&inStockOnly=true',
        { waitUntil: 'domcontentloaded' },
    );
    await delayedChunk.waitUntilRequested();

    const pendingTransition = page.locator('.route-transition[role="status"]');
    try {
        await expect(pendingTransition).toBeVisible();
        await expect(pendingTransition).toHaveAttribute('aria-label', '正在加载页面');
        await expect(pendingTransition).toHaveAttribute('aria-busy', 'true');
        await expect(pendingTransition.locator('.route-transition-card strong')).not.toBeEmpty();
        await expect(page.locator('.page-skeleton--route')).toHaveCount(0);
        await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
    } finally {
        delayedChunk.release();
    }

    await navigation;
    await expect(page.locator('main.category-page')).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get('collectionId')).toBe('collection-1');
    expect(url.searchParams.get('childId')).toBe('child-1');
    expect(url.searchParams.get('sort')).toBe('sales');
    expect(url.searchParams.get('fulfillment')).toBe('digital');
    expect(url.searchParams.get('inStockOnly')).toBe('true');
});

test('目标路由未解析时底部导航保持当前页高亮', async ({ page }) => {
    await authorizeLocalStorefront(page);
    await isolateRouteLoadingFromShopApi(page);
    await page.goto('/category', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main.category-page')).toBeVisible();
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
    await expect(page.locator('main.category-page')).toBeVisible();

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
