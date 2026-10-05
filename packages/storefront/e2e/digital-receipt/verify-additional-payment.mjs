import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'artifacts/digital-receipt/closure-20261004');
const origin = 'http://127.0.0.1:5193';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
    for (const width of [390, 1440])
        for (const outcome of ['success', 'unknown']) {
            const context = await browser.newContext({ viewport: { width, height: 1000 } });
            const page = await context.newPage();
            const errors = [];
            const external = [];
            page.on('pageerror', error => errors.push(String(error)));
            await page.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.origin !== origin || /\/(shop-api|admin-api)(?:$|\?)/.test(url.pathname)) {
                    external.push(url.origin + url.pathname);
                    return route.abort();
                }
                return route.continue();
            });
            await page.goto(
                `${origin}/e2e/digital-receipt/index.html?page=confirmation&additional=${outcome}`,
            );
            const panel = page.getByRole('region', { name: '订单补款' });
            const pay = panel.getByRole('button', { name: /确认支付/ });
            await expect(pay).toBeEnabled();
            await expect(page.locator('.order-confirmation-hero h1')).toHaveText('订单待补款');
            await expect(page.locator('.order-confirmation-summary')).toContainText('待补款');
            await expect(page.locator('.order-confirmation-summary')).not.toContainText('未知状态');
            await expect(page.getByRole('button', { name: '领取内容', exact: true })).toHaveCount(0);
            await expect(page.getByRole('region', { name: '领取数字商品' })).not.toContainText(
                '您仍可在这里领取',
            );
            expect((await page.evaluate(() => window.fixtureStats())).additionalSubmissions).toBe(0);
            await pay.click();
            await expect
                .poll(async () => (await page.evaluate(() => window.fixtureStats())).additionalSubmissions)
                .toBe(1);
            if (outcome === 'unknown') {
                await expect(panel).toContainText('结果确认前不要再次支付');
                await expect(pay).toBeDisabled();
                await panel.getByRole('button', { name: '刷新付款状态' }).click();
                await expect(pay).toBeDisabled();
            } else {
                await expect(panel).toHaveCount(0);
                await expect(page.locator('.order-confirmation-hero h1')).toHaveText('订单提交成功');
            }
            const stats = await page.evaluate(() => window.fixtureStats());
            expect(stats.additionalExpectedAmount).toBe(500);
            expect(stats.proofMatched).toBe(true);
            expect(stats.additionalSubmissions).toBe(1);
            const sizes = await page.evaluate(() => ({
                body: document.body.scrollWidth,
                document: document.documentElement.scrollWidth,
                viewport: innerWidth,
            }));
            expect(sizes.body).toBeLessThanOrEqual(width);
            expect(sizes.document).toBeLessThanOrEqual(width);
            expect(errors).toEqual([]);
            expect(external).toEqual([]);
            await page.screenshot({
                path: path.join(output, `additional-${width}-${outcome}.png`),
                fullPage: true,
            });
            results.push({ width, outcome, stats, sizes, errors, external, passed: true });
            await context.close();
        }
    await writeFile(
        path.join(output, 'additional-payment-results.json'),
        JSON.stringify({ syntheticOnly: true, results }, null, 2),
    );
    process.stdout.write(format('Additional payment formal confirmation page: 4 scenarios passed') + '\n');
} finally {
    await browser.close();
}
