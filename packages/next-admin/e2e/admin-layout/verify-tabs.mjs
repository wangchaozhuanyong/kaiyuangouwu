import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base =
    process.env.TAB_TEST_URL ??
    'http://127.0.0.1:5319/e2e/admin-layout/index.html?view=tabs&light&slowReads=700';
const output = fileURLToPath(new URL('./results/tab-navigation/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
try {
    for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
    ]) {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(5000);
        page.on('pageerror', error => errors.push(error.message));
        const productName = () => page.getByRole('textbox', { name: /^名称/ });
        const listTab = () => page.getByRole('link', { name: '商品列表', exact: true }).last();
        const productTabs = () => page.getByRole('link', { name: '编辑商品详情', exact: true });
        const retainedEditors = () => page.locator('#main-content input[id$="-name"]');
        const selectList = async () => {
            if (await listTab().isVisible()) await listTab().click();
            else {
                if (!(await page.locator('#open-tabs-menu').isVisible()))
                    await page.getByRole('button', { name: /^更多\s*\d*$/ }).click();
                await page.getByRole('menuitem', { name: '商品列表', exact: true }).click();
            }
        };
        const selectProduct = async index => {
            if (viewport.width < 768)
                await page
                    .getByRole('link', { name: index === 0 ? '测试商品一' : '测试商品二', exact: true })
                    .click();
            else await productTabs().nth(index).click();
        };
        const closeFirstEditor = async () => {
            const close = page.getByRole('button', { name: '关闭编辑商品详情标签', exact: true }).first();
            if (await close.isVisible()) await close.click();
            else {
                if (!(await page.getByRole('menu', { name: '' }).isVisible()))
                    await page.getByRole('button', { name: /^更多\s*\d*$/ }).click();
                await page
                    .getByRole('menuitem', { name: '关闭编辑商品详情标签', exact: true })
                    .first()
                    .click();
            }
        };
        const operations = () =>
            page.evaluate(() =>
                window.tabOperations.map(operation => ({
                    name: operation.name,
                    id: operation.variables.id ?? operation.variables.productId ?? null,
                })),
            );
        const settleEditor = async id => {
            // Warm-switch assertions must start after initial dependent reads, including
            // prices and packaging triggered by the product workspace, have completed.
            await expect
                .poll(() =>
                    page.evaluate(
                        productId =>
                            [
                                'GetProductDetail',
                                'NextAdminCatalogProductWorkspace',
                                'NextAdminProductVariantPrices',
                                'NextAdminProductPackagingWorkspace',
                            ].every(
                                name =>
                                    window.tabOperations
                                        .filter(
                                            operation =>
                                                operation.name === name &&
                                                (operation.variables.id ?? operation.variables.productId) ===
                                                    productId,
                                        )
                                        .at(-1)?.completed,
                            ),
                        id,
                    ),
                )
                .toBe(true);
        };
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await expect(listTab()).toBeVisible();
        await page.getByRole('combobox', { name: '每页显示条数', exact: true }).selectOption('50');
        await expect(page.getByRole('combobox', { name: '每页显示条数', exact: true })).toHaveValue('50');
        // Complete dependent reads before testing a warm retained-page switch.
        await expect
            .poll(() =>
                page.evaluate(() =>
                    [
                        'GetProducts',
                        'NextAdminCatalogProductOperations',
                        'GetCatalogChannelAssignments',
                    ].every(
                        name =>
                            window.tabOperations.filter(operation => operation.name === name).at(-1)
                                ?.completed,
                    ),
                ),
            )
            .toBe(true);
        await expect(page.locator('[data-refreshing]')).toHaveCount(0);
        await page.getByRole('link', { name: '测试商品一', exact: true }).click();
        await expect(productName()).toHaveValue('布局验收示例商品');
        await productName().fill('商品一未保存草稿');
        await settleEditor('layout-product');
        await page.getByRole('link', { name: '测试商品二', exact: true }).click();
        await expect(productName()).toHaveValue('布局验收示例商品');
        await productName().fill('商品二未保存草稿');
        await settleEditor('layout-product-2');
        await expect(retainedEditors()).toHaveCount(2);
        // A label must target the visible input even while another editor is retained.
        await page.locator('#main-content label:visible').filter({ hasText: /^名称/ }).click();
        await expect(productName()).toBeFocused();
        const beforeDraftRefresh = (await operations()).filter(
            operation => operation.name === 'GetProductDetail' && operation.id === 'layout-product-2',
        ).length;
        await page.getByRole('button', { name: '刷新当前测试标签', exact: true }).click();
        await expect
            .poll(
                async () =>
                    (await operations()).filter(
                        operation =>
                            operation.name === 'GetProductDetail' && operation.id === 'layout-product-2',
                    ).length,
            )
            .toBe(beforeDraftRefresh + 1);
        await expect(page.getByText('正在更新本页数据…')).toBeVisible();
        expect(await page.locator('[title="有未保存变更"]:visible').count()).toBe(1);
        await expect(page.locator('[data-refreshing]')).toHaveCount(0);
        await expect(productName()).toHaveValue('商品二未保存草稿');
        checks.push(
            `${viewport.width}px: refreshing an edited product retains its unsaved draft after the read completes`,
        );
        const baseline = await operations();
        for (let index = 0; index < 3; index++) {
            await selectProduct(0);
            await expect(productName()).toHaveValue('商品一未保存草稿');
            await selectProduct(1);
            await expect(productName()).toHaveValue('商品二未保存草稿');
            await selectList();
            await expect(page.getByRole('combobox', { name: '每页显示条数', exact: true })).toHaveValue('50');
        }
        expect(await operations()).toEqual(baseline);
        checks.push(
            `${viewport.width}px: repeated switching retains both product drafts and list page size with zero additional GraphQL queries`,
        );

        let dialogs = 0;
        const rejectClose = async dialog => {
            dialogs++;
            await dialog.dismiss();
        };
        page.on('dialog', rejectClose);
        await closeFirstEditor();
        await expect(retainedEditors()).toHaveCount(2);
        expect(dialogs).toBe(1);
        page.off('dialog', rejectClose);
        page.once('dialog', dialog => dialog.accept());
        await closeFirstEditor();
        await expect(retainedEditors()).toHaveCount(1);
        await page.getByRole('link', { name: '测试商品一', exact: true }).click();
        await expect(productName()).toHaveValue('布局验收示例商品');
        const beforeDetail = baseline.filter(
            operation => operation.name === 'GetProductDetail' && operation.id === 'layout-product',
        ).length;
        const afterDetail = (await operations()).filter(
            operation => operation.name === 'GetProductDetail' && operation.id === 'layout-product',
        ).length;
        expect(afterDetail).toBe(beforeDetail);
        checks.push(
            `${viewport.width}px: cancelling a dirty tab close preserves it; confirmed close releases it and reopening resets the form using valid cached detail`,
        );

        await selectList();
        const beforeRefresh = (await operations()).filter(
            operation => operation.name === 'GetProducts',
        ).length;
        await page.getByRole('button', { name: '刷新', exact: true }).click();
        await expect
            .poll(
                async () => (await operations()).filter(operation => operation.name === 'GetProducts').length,
            )
            .toBe(beforeRefresh + 1);
        checks.push(`${viewport.width}px: manual list refresh still requests fresh data`);
        await page.screenshot({ path: `${output}/${viewport.width}px.png` });
        await page.close();
    }
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/checks.json`,
        JSON.stringify(
            {
                source: 'local synthetic data with real AppShell, CatalogModule and ProductEditor; no writes or production acceptance',
                checks,
                errors,
            },
            null,
            2,
        ),
    );
    console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
} finally {
    await browser.close();
}
