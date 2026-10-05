import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../artifacts/order-processing/closure-20261004',
);
const origin = process.env.ORDER_PROCESSING_TEST_ORIGIN || 'http://127.0.0.1:5192';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [],
    externalRequests = [],
    results = [];
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'zh-CN' });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            const url = route.request().url();
            if ((url.startsWith(origin + '/') || url.startsWith('data:')) && !url.includes('/admin-api'))
                return route.continue();
            externalRequests.push(url);
            return route.abort();
        });
        for (const failed of [false, true]) {
            await page.goto(
                origin +
                    '/e2e/order-processing/index.html?order=DIGITAL&resource-review' +
                    (failed ? '&resource-retry-failure' : ''),
            );
            await expect(page.getByText('没有生产、资金或邮件连接', { exact: false })).toBeVisible();
            const summary = page.getByRole('region', { name: '订单处理进度' });
            await expect(summary).toContainText('交付资源不足');
            await summary.getByRole('button', { name: '重试交付', exact: true }).click();
            if (failed) {
                await expect(
                    page.getByText('库存仍不足，请补货后重试（合成）', { exact: false }),
                ).toBeVisible();
                await expect(summary.getByRole('button', { name: '重试交付', exact: true })).toBeEnabled();
                await expect(summary).toContainText('交付异常待处理');
            } else {
                await expect(summary.getByRole('button', { name: '准备交付', exact: true })).toBeEnabled();
                await expect(summary).not.toContainText('交付资源不足');
            }
            expect(await page.evaluate(() => window.orderProcessingFixture.writes)).toEqual([
                { operation: 'RetryCheckoutDelivery', orderId: 'DIGITAL' },
            ]);
            const sizes = await page.evaluate(() => ({
                viewport: innerWidth,
                document: document.documentElement.scrollWidth,
            }));
            expect(sizes.document).toBeLessThanOrEqual(width);
            await page.screenshot({
                path: path.join(output, `resource-retry-${width}-${failed ? 'failed' : 'confirmed'}.png`),
                fullPage: true,
            });
            results.push({ width, response: failed ? 'REVIEW' : 'CONFIRMED', passed: true, sizes });
        }
        await page.close();
    }
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
    await writeFile(
        path.join(output, 'resource-retry-results.json'),
        JSON.stringify(
            {
                passed: true,
                source: 'formal OrderEditor with synthetic in-memory Apollo transport',
                productionConnection: false,
                realFunds: 'NOT_MEASURED',
                smtp: 'NOT_MEASURED',
                errors,
                externalRequests,
                results,
            },
            null,
            2,
        ),
    );
    console.log(`Order resource retry browser scenarios passed: ${results.length}`);
} finally {
    await browser.close();
}
