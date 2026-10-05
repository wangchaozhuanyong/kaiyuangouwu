import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.ADMIN_TEST_ORIGIN ?? 'http://127.0.0.1:5338';
const output = fileURLToPath(new URL('./results/unified-runtime/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [],
    errors = [];
const views = [
    'draft',
    'team',
    'allocation',
    'assets',
    'cardpool',
    'aftersales',
    'dashboard',
    'sales',
    'reviews',
    'catalog',
    'suppliers',
    'paymentSettings',
    'product',
    'profit',
    'translations',
    'jobs',
    'health',
    'usdt',
    'plugins',
    'copy',
    'categories',
    'purchases',
    'stores',
];
try {
    for (const mode of [
        { width: 1440, height: 1000, theme: 'light', touch: false, views },
        {
            width: 390,
            height: 844,
            theme: 'light',
            touch: true,
            views: ['product', 'catalog', 'dashboard', 'sales', 'plugins', 'copy', 'stores'],
        },
        {
            width: 1440,
            height: 1000,
            theme: 'dark',
            touch: false,
            views: ['product', 'catalog', 'dashboard', 'sales', 'plugins', 'copy', 'stores'],
        },
        {
            width: 390,
            height: 844,
            theme: 'dark',
            touch: true,
            views: ['product', 'catalog', 'dashboard', 'sales', 'plugins', 'copy', 'stores'],
        },
    ]) {
        const context = await browser.newContext({
            viewport: { width: mode.width, height: mode.height },
            hasTouch: mode.touch,
        });
        await context.addInitScript(theme => localStorage.setItem('vendure-admin-theme', theme), mode.theme);
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on('pageerror', error => errors.push({ mode: mode.theme, message: error.message }));
        for (const view of mode.views.filter(
            view => !process.env.ADMIN_TEST_VIEWS || process.env.ADMIN_TEST_VIEWS.split(',').includes(view),
        )) {
            await page.goto(
                `${origin}/e2e/admin-layout/index.html?view=${view}&multi${mode.theme === 'light' ? '&light' : ''}`,
                { waitUntil: 'domcontentloaded', timeout: 60_000 },
            );
            await expect(page.locator('[data-admin-page]')).toBeVisible();
            await expect(page.locator('[data-layout-fixture-error]')).toHaveCount(0);
            await expect(
                page.getByRole('heading', { name: '当前页面暂时无法显示', exact: true }),
            ).toHaveCount(0);
            if (view === 'sales') {
                await expect(page.getByRole('heading', { name: /^订单处理台/ })).toBeVisible();
                if (mode.touch)
                    await expect(page.getByRole('button', { name: '筛选与排序', exact: true })).toBeVisible();
            }
            await expect
                .poll(() =>
                    page.locator('[data-admin-page] .admin-button,[data-admin-page] .admin-control').count(),
                )
                .toBeGreaterThan(0);
            // Allow initial query/effect commits to settle; this measures layout, not network latency.
            await expect.poll(() => page.locator('[data-refreshing]').count()).toBe(0);
            await expect(page.locator('[data-admin-extension-loading]:visible')).toHaveCount(0);
            await expect(page.locator('[data-admin-extension-error]')).toHaveCount(0);
            const dimensions = await page.evaluate(() => ({
                viewport: innerWidth,
                document: document.documentElement.scrollWidth,
                controls: [...document.querySelectorAll('.admin-button,.admin-control')]
                    .filter(
                        element =>
                            element.getBoundingClientRect().width && element.getBoundingClientRect().height,
                    )
                    .map(element => ({
                        height: element.getBoundingClientRect().height,
                        minHeight: parseFloat(getComputedStyle(element).minHeight) || 0,
                    })),
            }));
            expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
            if (mode.touch)
                expect(
                    dimensions.controls.filter(control => control.minHeight < 44),
                    `${view} ${mode.theme}: touch control minimum`,
                ).toEqual([]);
            const filename = `${view}-${mode.width}-${mode.theme}.png`;
            await page.screenshot({ path: `${output}/${filename}` });
            receipts.push({
                view,
                width: mode.width,
                theme: mode.theme,
                controls: dimensions.controls.length,
                documentWidth: dimensions.document,
                screenshot: filename,
            });
        }
        await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push({ scene: 'read-failure', message: error.message }));
    await page.goto(`${origin}/e2e/admin-layout/index.html?view=tabs&light&slowReads&failRefresh`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: '布局验收示例商品', exact: true })).toBeVisible();
    await expect(page.locator('[data-refreshing]')).toHaveCount(0);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByText('正在更新本页数据…')).toBeVisible();
    await expect(page.getByRole('button', { name: '布局验收示例商品', exact: true })).toBeVisible();
    await expect(page.getByText('1 项数据更新失败，已保留可用内容')).toBeVisible();
    await expect(page.getByRole('button', { name: '重试本页', exact: true })).toBeEnabled();
    await page.screenshot({ path: `${output}/refresh-failure.png` });
    await context.setOffline(true);
    await expect(page.getByText('网络已断开，已加载的内容仍可查看')).toBeVisible();
    await expect(page.getByRole('button', { name: '布局验收示例商品', exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/offline.png` });
    receipts.push({ scene: 'slow-refresh-failure-offline', dataRetained: true, retryAvailable: true });
    await context.close();
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/checks.json`,
        JSON.stringify(
            {
                source: 'local synthetic data; layout/state acceptance only; all writes rejected',
                receipts,
                errors,
            },
            null,
            2,
        ),
    );
    console.log(JSON.stringify({ passed: receipts.length, output, errors }, null, 2));
} finally {
    await browser.close();
}
