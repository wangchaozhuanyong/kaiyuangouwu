import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.ADMIN_TEST_ORIGIN ?? 'http://127.0.0.1:5192';
const output = fileURLToPath(
    new URL('../../artifacts/order-processing/closure-20261005/product-domains/', import.meta.url),
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
try {
    for (const width of [390, 1440]) {
        const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 1000 },
            hasTouch: width === 390,
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && !/\/(?:admin-api|shop-api|api)(?:\/|$)/.test(url.pathname))
                return route.continue();
            errors.push({ width, message: 'Unexpected HTTP request', url: url.origin + url.pathname });
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push({ width, message: error.message }));
        page.on('console', message => {
            if (message.type() === 'error') errors.push({ width, message: message.text() });
        });
        for (const domain of ['digital', 'physical']) {
            await page.goto(
                origin +
                    '/e2e/admin-layout/index.html?view=product&light&multi' +
                    (domain === 'digital' ? '&digital' : ''),
                { waitUntil: 'domcontentloaded' },
            );
            await expect(page.getByRole('button', { name: '保存商品', exact: true })).toBeVisible();
            await expect(page.locator('[data-layout-fixture-error]')).toHaveCount(0);
            const workspace = page.locator('[data-product-domain="' + domain + '"]');
            await expect(workspace).toBeAttached();
            await expect(
                page.locator(
                    '[data-product-domain="' + (domain === 'digital' ? 'physical' : 'digital') + '"]',
                ),
            ).toHaveCount(0);
            if (domain === 'digital') {
                const mode = page.getByLabel('统一交付方式', { exact: true });
                await expect(mode).toHaveValue('manual_service');
                await page.getByLabel('规格 1 销售数量', { exact: true }).selectOption('limited');
                await page.getByLabel('规格 1 可售份数', { exact: true }).fill('12');
                await expect(page.getByLabel('规格 1 可售份数', { exact: true })).toHaveValue('12');
                await mode.selectOption('file_download');
                await expect(page.getByLabel('上传统一交付文件', { exact: true })).toBeVisible();
                await mode.selectOption('auto_card');
                await expect(page.getByLabel('规格 1 可售份数', { exact: true })).toHaveCount(0);
                await expect(page.getByLabel('上传统一交付文件', { exact: true })).toHaveCount(0);
                await mode.selectOption('manual_service');
                await expect(page.getByLabel('预计人工处理时长', { exact: true })).toBeVisible();
            } else {
                await expect(workspace).toContainText('仓库库存');
                await workspace.locator('summary').first().click();
                await expect(page.getByLabel('规格 1 包装换算', { exact: true })).toHaveValue('1');
                await expect(page.getByLabel('规格 1 默认保质期', { exact: true })).toHaveValue('365');
                await expect(page.getByLabel('统一交付方式', { exact: true })).toHaveCount(0);
                await expect(
                    page
                        .getByLabel('退款规则', { exact: true })
                        .locator('option[value="SEVEN_DAY_NO_REASON"]'),
                ).toHaveCount(1);
            }
            if (width === 390) {
                if (domain === 'digital') {
                    await page.getByLabel('规格 1 销售数量', { exact: true }).selectOption('limited');
                    await page.getByLabel('规格 1 可售份数', { exact: true }).fill('12');
                }
                const chapters = page.getByLabel('商品编辑章节', { exact: true });
                await chapters.selectOption('pricing');
                await expect(chapters).toHaveValue('pricing');
                await chapters.selectOption('delivery');
                await expect(chapters).toHaveValue('delivery');
                await expect(page.locator('section[id$="-delivery"]')).toBeInViewport();
                if (domain === 'digital') {
                    await expect(page.getByLabel('规格 1 可售份数', { exact: true })).toHaveValue('12');
                } else {
                    await expect(page.getByLabel('规格 1 默认保质期', { exact: true })).toHaveValue('365');
                }
                results.push({ width, domain: domain + '-chapter-draft-preserved', status: 'PASS' });
            }
            await workspace.scrollIntoViewIfNeeded();
            const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            expect(documentWidth).toBeLessThanOrEqual(width + 1);
            await page.screenshot({ path: output + domain + '-' + width + '.png' });
            results.push({ width, domain, status: 'PASS', documentWidth });
        }
        await page.goto(origin + '/e2e/admin-layout/index.html?view=product&light&digital&migration', {
            waitUntil: 'domcontentloaded',
        });
        await expect(page.getByLabel('统一交付方式', { exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: '核对旧库存', exact: true })).toBeVisible();
        await expect(
            page.getByText('该规格仍使用旧数字库存，需要先核对迁移。', { exact: true }),
        ).toBeVisible();
        results.push({ width, domain: 'digital-legacy-migration', status: 'PASS' });
        await context.close();
    }
    expect(errors).toEqual([]);
} finally {
    await writeFile(output + 'results.json', JSON.stringify({ results, errors }, null, 2));
    await browser.close();
}
console.log('Product-domain browser acceptance: ' + results.length + ' scenarios PASS');
