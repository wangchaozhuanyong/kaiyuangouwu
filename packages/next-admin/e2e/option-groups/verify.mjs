import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base =
    process.env.OPTION_GROUP_TEST_URL ?? 'http://127.0.0.1:5311/e2e/option-groups/index.html?tab=options';
const output = path.resolve('../../../reports/option-group-linked-products-20260907');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));

try {
    await page.goto(base);
    await expect(page.getByText('规格模板共 25 个', { exact: true })).toBeVisible();
    await expect(page.getByText('规格模板 1', { exact: true })).toBeVisible();
    await expect(page.getByText('规格模板 25', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '下一页规格模板', exact: true }).click();
    await expect(page.getByText('规格模板 25', { exact: true })).toBeVisible();
    checks.push('25 个规格模板按 20 个分页展示');

    const templateSearch = page.getByRole('textbox', { name: '搜索规格模板', exact: true });
    await templateSearch.fill('选项值 25');
    await expect(page.getByText('规格模板 25', { exact: true })).toBeVisible();
    await expect(page.getByText('规格模板 24', { exact: true })).toHaveCount(0);
    checks.push('模板名、编码和选项值可搜索');

    await expect(page.getByRole('button', { name: '删除规格模板：规格模板 25' })).toBeDisabled();
    await page.getByRole('button', { name: '查看使用规格模板《规格模板 25》的 12 个商品' }).click();
    const dialog = page.getByRole('dialog', { name: '规格模板 25关联商品', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^打开商品：/ })).toHaveCount(10);
    await dialog.getByRole('button', { name: '下一页关联商品', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '打开商品：关联商品 12', exact: true })).toBeVisible();
    checks.push('关联商品弹窗返回真实列表并按 10 个分页');

    const linkedSearch = dialog.getByRole('textbox', { name: '搜索关联商品', exact: true });
    await linkedSearch.fill('关联商品 12');
    await expect(dialog.getByRole('button', { name: '打开商品：关联商品 12', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^打开商品：/ })).toHaveCount(1);
    checks.push('关联商品搜索保留规格模板范围');

    await page.screenshot({ path: path.join(output, 'linked-products-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await expect
        .poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth))
        .toBe(true);
    await page.screenshot({ path: path.join(output, 'linked-products-mobile.png'), fullPage: true });
    checks.push('1440px 桌面和 390px 手机弹窗无水平溢出');

    await dialog.getByRole('button', { name: '打开商品：关联商品 12', exact: true }).click();
    await expect(page).toHaveURL(/\/catalog\/products\/linked-product-12\?tab=variants$/);
    checks.push('选中商品可直达其规格管理页');

    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'browser-verification.json'),
        JSON.stringify({ checks, errors, mockedApi: true }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) {
    await page.screenshot({ path: path.join(output, 'browser-failure.png'), fullPage: true });
    console.error(JSON.stringify({ errors, url: page.url() }));
    throw error;
} finally {
    await browser.close();
}
