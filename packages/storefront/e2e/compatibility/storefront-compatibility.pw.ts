import { expect, test, type Page } from '@playwright/test';

const routes = ['/', '/login', '/register', '/support', '/legal?id=privacy'];

async function enterStorefront(page: Page) {
    if (!process.env.COMPAT_BASE_URL) {
        const productionAccessCookie = process.env.COMPAT_STOREFRONT_ENTRY_COOKIE;
        if (!productionAccessCookie) {
            throw new Error('全局初始化应提供推广入口 Cookie');
        }
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

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    if (new URL(page.url()).pathname.startsWith('/promo')) {
        const entryForm = page.locator('form[data-store-entry]').first();
        await expect(entryForm).toBeVisible();
        await Promise.all([
            page.waitForURL(url => !url.pathname.startsWith('/promo')),
            entryForm.evaluate(form => (form as HTMLFormElement).submit()),
        ]);
    }

    await expect(page.locator('#root')).toBeVisible();
}

test('核心公开页面在目标浏览器中正常渲染', async ({ page }) => {
    const pageErrors: string[] = [];
    const badResources: string[] = [];

    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
        const resourceType = response.request().resourceType();
        if (
            response.status() >= 400 &&
            ['document', 'script', 'stylesheet', 'font', 'image'].includes(resourceType)
        ) {
            badResources.push(`${response.status()}:${resourceType}:${response.url()}`);
        }
    });

    await enterStorefront(page);

    for (const route of routes) {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${route} 应返回成功状态`).toBeLessThan(400);
        await expect(page.locator('#root')).toBeVisible();
        await expect
            .poll(() =>
                page
                    .locator('body')
                    .innerText()
                    .then(text => text.trim().length),
            )
            .toBeGreaterThan(20);

        const visualState = await page.evaluate(() => ({
            horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            brokenImages: [...document.images]
                .filter(image => image.complete && image.naturalWidth === 0)
                .map(image => image.currentSrc || image.src),
        }));

        expect(visualState.horizontalOverflow, `${route} 不应产生页面级横向溢出`).toBeLessThanOrEqual(1);
        expect(visualState.brokenImages, `${route} 不应包含破损图片`).toEqual([]);

        if (route === '/') {
            const actions = page.locator('.section-header-action-btn');
            await expect(actions.first()).toBeVisible();

            for (let index = 0; index < (await actions.count()); index += 1) {
                const box = await actions.nth(index).boundingBox();
                expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
                expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
            }
        }
    }

    expect(pageErrors).toEqual([]);
    expect(badResources).toEqual([]);
});

test('旧版浏览器降级页可独立渲染', async ({ page }) => {
    const response = await page.goto('/unsupported-browser.html', { waitUntil: 'domcontentloaded' });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '请切换到极速模式后继续访问' })).toBeVisible();
    await expect(page.getByRole('link', { name: '切换后重新进入商城' })).toHaveAttribute('href', '/');
    await expect(page.locator('script')).toHaveCount(0);

    const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
});
