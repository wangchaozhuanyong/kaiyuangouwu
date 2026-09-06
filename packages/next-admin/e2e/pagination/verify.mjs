import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.PAGINATION_TEST_URL ?? 'http://127.0.0.1:5307/e2e/pagination/index.html';
const output = process.env.STOREFRONT_TEST_OUTPUT ?? path.resolve('e2e/pagination/results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const size = () => page.getByRole('combobox', { name: '每页显示条数', exact: true });
const rows = () => page.locator('table tbody tr');
const lastOptions = name =>
    page.evaluate(
        name => window.paginationFixture.operations.filter(o => o.name === name).at(-1)?.variables.options,
        name,
    );
try {
    for (const [view, operation] of [
        ['products', 'GetProducts'],
        ['sales', 'GetSalesOrders'],
        ['customers', 'AdminCustomers'],
        ['suppliers', 'NextAdminCatalogSuppliers'],
    ]) {
        await page.goto(`${base}?view=${view}`);
        await expect(size()).toHaveValue('20');
        await expect(rows()).toHaveCount(20);
        expect(await lastOptions(operation)).toMatchObject({ skip: 0, take: 20 });
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        await expect.poll(() => lastOptions(operation)).toMatchObject({ skip: 20, take: 20 });
        await expect(size()).toBeEnabled();
        if (view === 'customers') await page.getByRole('checkbox').first().check();
        await size().selectOption('50');
        await expect(rows()).toHaveCount(50);
        expect(await lastOptions(operation)).toMatchObject({ skip: 0, take: 50 });
        if (view === 'customers')
            expect(
                await page.getByRole('checkbox').evaluateAll(elements => elements.some(e => e.checked)),
            ).toBe(false);
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        await expect.poll(() => lastOptions(operation)).toMatchObject({ skip: 50, take: 50 });
        await expect(size()).toBeEnabled();
        await size().selectOption('100');
        await expect(rows()).toHaveCount(100);
        expect(await lastOptions(operation)).toMatchObject({ skip: 0, take: 100 });
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        await expect.poll(() => lastOptions(operation)).toMatchObject({ skip: 100, take: 100 });
        await expect(size()).toBeEnabled();
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        await expect(rows()).toHaveCount(37);
        await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
        if (view !== 'suppliers') {
            await page.reload();
            await expect(size()).toHaveValue('100');
            await expect(rows()).toHaveCount(37);
        }
        await size().selectOption('20');
        await expect(rows()).toHaveCount(20);
        await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
        checks.push(
            `${view}: 20/50/100 rows match API take; offsets/reset/last-page boundaries${view === 'suppliers' ? '' : '/URL refresh'}${view === 'customers' ? '/bulk selection cleared' : ''}`,
        );
    }
    await page.goto(`${base}?view=products&search=保留搜索&category=fixture-category&status=enabled&page=3`);
    await expect(rows()).toHaveCount(20);
    await size().selectOption('50');
    await expect(rows()).toHaveCount(50);
    let url = new URL(page.url());
    expect(url.searchParams.get('search')).toBe('保留搜索');
    expect(url.searchParams.get('category')).toBe('fixture-category');
    expect(url.searchParams.get('status')).toBe('enabled');
    expect(url.searchParams.get('page')).toBeNull();
    expect(await lastOptions('GetProducts')).toMatchObject({
        take: 50,
        skip: 0,
        filter: {
            name: { contains: '保留搜索' },
            enabled: { eq: true },
            collectionId: { eq: 'fixture-category' },
        },
    });
    checks.push('Product search, category and enabled filter survive page-size changes in URL and API');
    for (const invalid of ['0', '-20', '17', '999999999', 'NaN', 'Infinity', '50.5', '20x']) {
        await page.goto(`${base}?pageSize=${invalid}`);
        await expect(size()).toHaveValue('20');
        await expect(rows()).toHaveCount(20);
        expect(await lastOptions('GetProducts')).toMatchObject({ take: 20 });
    }
    checks.push('Invalid and unsupported URL sizes safely fall back to 20');
    await page.goto(`${base}?view=sales&empty`);
    await expect(size()).toHaveValue('20');
    await size().selectOption('50');
    await expect(size()).toHaveValue('50');
    await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    checks.push('Empty list retains size selection and disables both page buttons');

    await page.goto(`${base}?view=products`);
    await expect(rows()).toHaveCount(20);
    await page.evaluate(() => {
        window.paginationFixture.delay = 400;
    });
    await size().selectOption('50');
    await expect(size()).toBeDisabled();
    await expect(rows()).toHaveCount(50);
    await expect(size()).toBeEnabled();
    await page.evaluate(() => {
        window.paginationFixture.fail = true;
    });
    await size().selectOption('100');
    await expect(page.getByText('商品数据加载失败', { exact: false })).toBeVisible();
    await page.evaluate(() => {
        window.paginationFixture.fail = false;
    });
    await page.getByRole('button', { name: /重试|重新/ }).click();
    await expect(rows()).toHaveCount(100);
    checks.push('Loading disables page-size control; failed page query remains recoverable by retry');

    await page.goto(`${base}?view=lookups`);
    const first = page.getByRole('region', { name: '素材选择', exact: true });
    const second = page.getByRole('region', { name: '分类选择', exact: true });
    await first.getByRole('combobox').selectOption('50');
    await expect(first.locator('output')).toHaveText('{"skip":0,"take":50}');
    await expect(second.locator('output')).toHaveText('{"skip":40,"take":20}');
    const reports = page.getByRole('region', { name: '关联报表', exact: true });
    await reports.getByRole('combobox').first().selectOption('100');
    await expect(reports.locator('output')).toHaveText('{"skips":[0,0],"take":100}');
    await expect(reports.getByRole('combobox').nth(1)).toHaveValue('100');
    checks.push('Independent selectors preserve other lists; shared report take resets every linked offset');
    for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
        await page.screenshot({ path: path.join(output, `pagination-lookups-${width}.png`) });
    }
    for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}?view=products`);
        await expect(rows()).toHaveCount(20);
        await size().scrollIntoViewIfNeeded();
        const bounds = await size().boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: path.join(output, `pagination-products-${width}.png`) });
    }
    checks.push(
        '1440px desktop, 768px tablet and 390px mobile: footer controls visible and lookup layout has no overflow',
    );
    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'browser-verification.json'),
        JSON.stringify({ checks, errors, mockedApi: true }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) {
    await page.screenshot({ path: path.join(output, 'browser-failure.png') });
    console.error(JSON.stringify({ errors, url: page.url() }));
    throw error;
} finally {
    await browser.close();
}
