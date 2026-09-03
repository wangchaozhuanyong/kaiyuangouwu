import { expect, test, type Locator, type Page } from '@playwright/test';

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

async function mockActiveCoupons(page: Page, campaigns: Array<Record<string, unknown>>) {
    await page.route('**/shop-api?**', async route => {
        const requestBody = route.request().postDataJSON() as { query?: string } | null;
        if (!requestBody?.query?.includes('query ActiveStorefrontCoupons')) {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: { activeStorefrontCoupons: campaigns } }),
        });
    });
}

async function waitForHomepageContent(page: Page, content: Locator) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const retryButton = page.getByRole('button', { name: /^(?:重新加载|Try again)$/u });
        if (await retryButton.isVisible()) await retryButton.click();

        try {
            await content.first().waitFor({ state: 'visible', timeout: 10_000 });
            return content;
        } catch (error) {
            if (attempt === 2) throw error;
            await page.reload({ waitUntil: 'domcontentloaded' });
        }
    }

    return content;
}

async function waitForHomepageActions(page: Page) {
    return waitForHomepageContent(page, page.locator('.section-header-action-btn'));
}

async function openFirstProduct(page: Page) {
    const productEntry = page.getByRole('button', { name: /^查看 / }).first();
    await waitForHomepageContent(page, productEntry);
    await productEntry.click();
    await expect(page).toHaveURL(/\/product\?id=/);
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
            const actions = await waitForHomepageActions(page);

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

test('商品详情头部在页面滚动时保持可见', async ({ page }) => {
    await enterStorefront(page);

    await openFirstProduct(page);

    const header = page.locator('.product-detail-header');
    await expect(header).toBeVisible();
    await expect(page.locator('.detail-promotions')).toHaveCount(0);
    await expect(page.locator('.detail-info-row')).toHaveCount(0);

    const variantOptions = page.locator('.detail-options > div > button');
    const variantCount = await variantOptions.count();
    expect(variantCount).toBeGreaterThan(0);
    await expect(page.locator('.detail-options > header > span')).toHaveText(`${variantCount} 个规格可选`);

    const serviceItems = page.locator('.detail-service-bar > span');
    await expect(serviceItems).toHaveCount(3);
    const serviceGeometry = await serviceItems.evaluateAll(elements =>
        elements.map(element => {
            const box = element.getBoundingClientRect();
            return { top: Math.round(box.top), width: Math.round(box.width) };
        }),
    );
    expect(
        Math.max(...serviceGeometry.map(item => item.top)) -
            Math.min(...serviceGeometry.map(item => item.top)),
    ).toBeLessThanOrEqual(1);
    expect(
        Math.max(...serviceGeometry.map(item => item.width)) -
            Math.min(...serviceGeometry.map(item => item.width)),
    ).toBeLessThanOrEqual(1);

    await page.evaluate(() => window.scrollTo(0, Math.min(600, document.documentElement.scrollHeight)));

    await expect
        .poll(() => header.evaluate(element => Math.round(element.getBoundingClientRect().top)))
        .toBe(0);
});

test('商品详情显示匹配优惠券的券后价并可进入优惠券中心', async ({ page }) => {
    // The compatibility suite reads the live catalog, whose first product can use any channel currency.
    // Leaving the optional legacy field unset keeps this test focused on product applicability.
    await mockActiveCoupons(page, [
        {
            id: 'e2e-order-coupon',
            name: '全场八折券',
            kind: 'ORDER_PERCENTAGE',
            startsAt: null,
            endsAt: null,
            claimStartsAt: null,
            claimEndsAt: null,
            validityDays: null,
            minimumSpend: 0,
            discountAmount: null,
            discountRate: 8,
            collectionIds: [],
            productVariantIds: [],
            remainingIssueCount: 100,
            claimed: false,
            claimable: true,
        },
    ]);

    await enterStorefront(page);
    await openFirstProduct(page);

    const couponPrice = page.locator('.detail-coupon-price');
    await expect(couponPrice).toBeVisible();
    await expect(couponPrice).toContainText('券后');
    await couponPrice.click();
    await expect(page).toHaveURL(/\/coupons$/);
});

test('商品详情在优惠券不匹配时保持原价展示', async ({ page }) => {
    await mockActiveCoupons(page, [
        {
            id: 'e2e-other-product-coupon',
            name: '其他商品八折券',
            kind: 'PRODUCT_PERCENTAGE',
            startsAt: null,
            endsAt: null,
            claimStartsAt: null,
            claimEndsAt: null,
            validityDays: null,
            minimumSpend: 0,
            discountAmount: null,
            discountRate: 8,
            collectionIds: [],
            productVariantIds: ['a-variant-that-does-not-exist'],
            remainingIssueCount: 100,
            claimed: false,
            claimable: true,
        },
    ]);

    await enterStorefront(page);
    await openFirstProduct(page);

    await expect(page.locator('.detail-price')).toBeVisible();
    await expect(page.locator('.detail-coupon-price')).toHaveCount(0);
});

test('键盘焦点在原生选择控件和深色按钮上清晰可见', async ({ page }) => {
    await enterStorefront(page);
    await page.evaluate(() => {
        const fixture = document.createElement('div');
        fixture.dataset.focusFixture = 'true';
        fixture.style.cssText =
            'position:fixed;inset:8px auto auto 8px;z-index:99999;display:flex;gap:12px;padding:12px;background:white';
        fixture.innerHTML = [
            '<input data-focus-control="checkbox" type="checkbox" aria-label="测试复选框">',
            '<input data-focus-control="radio" type="radio" aria-label="测试单选框">',
            '<input data-focus-control="range" type="range" aria-label="测试范围">',
            '<button data-focus-control="button" style="background:#0f172a;color:white">测试按钮</button>',
            '<input data-focus-control="text" type="text" aria-label="测试文本框">',
        ].join('');
        document.body.prepend(fixture);
        (document.activeElement as HTMLElement | null)?.blur();
    });

    for (const controlName of ['checkbox', 'radio', 'range', 'button'] as const) {
        const control = page.locator(`[data-focus-control="${controlName}"]`);
        await control.focus();
        await expect(control).toBeFocused();
        const focusStyle = await control.evaluate(element => {
            const style = getComputedStyle(element);
            return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
        });
        expect(focusStyle.outlineStyle, `${controlName} 应显示焦点轮廓`).not.toBe('none');
        expect(focusStyle.outlineWidth, `${controlName} 焦点轮廓至少 2px`).toBeGreaterThanOrEqual(2);
    }

    const textControl = page.locator('[data-focus-control="text"]');
    await textControl.focus();
    await expect(textControl).toBeFocused();
    await expect
        .poll(() => textControl.evaluate(element => getComputedStyle(element).boxShadow))
        .not.toBe('none');
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
