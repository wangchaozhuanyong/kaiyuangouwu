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

async function delayRouteChunk(page: Page, chunkNames: readonly string[], delayMs = 800) {
    let delayed = false;
    await page.route(/\/assets\/[^/]+\.js(?:\?.*)?$/u, async route => {
        const fileName = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
        if (!delayed && chunkNames.some(chunkName => fileName.startsWith(`${chunkName}-`))) {
            delayed = true;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        await route.continue();
    });
}

test('分类页硬刷新显示中文路由骨架并保留筛选参数', async ({ page }) => {
    await authorizeLocalStorefront(page);
    await delayRouteChunk(page, ['category', 'catalog-route-pages', 'category-page']);

    await page.goto(
        '/category?collectionId=collection-1&childId=child-1&sort=sales&fulfillment=digital&inStockOnly=true',
        { waitUntil: 'domcontentloaded' },
    );

    const pendingMain = page.locator('main.page-skeleton--catalog[role="status"]');
    await expect(pendingMain).toBeVisible();
    await expect(pendingMain).toHaveAttribute('aria-label', '正在加载页面');
    await expect(pendingMain).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);

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
    await page.goto('/category', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main.category-page')).toBeVisible();
    await delayRouteChunk(page, ['services', 'content-route-pages', 'business-services-page']);

    const categoryNavigation = page.locator('nav[aria-label] a[href="/category"]');
    const servicesNavigation = page.locator('nav[aria-label] a[href="/services"]');
    await expect(categoryNavigation).toHaveAttribute('aria-current', 'page');

    await servicesNavigation.click();
    await expect(page).toHaveURL(/\/services(?:\?|$)/u);
    await expect(categoryNavigation).toHaveAttribute('aria-current', 'page');
    await expect(servicesNavigation).not.toHaveAttribute('aria-current', 'page');

    await expect(page.locator('main.business-services-page')).toBeVisible();
    await expect(servicesNavigation).toHaveAttribute('aria-current', 'page');
});
