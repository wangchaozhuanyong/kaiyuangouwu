import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'artifacts/digital-receipt/closure-20261005');
const origin = 'http://127.0.0.1:5193';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
    for (const width of [390, 1440])
        for (const outcome of ['usdt', 'wallet', 'wallet-refresh-failure']) {
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
            expect((await page.evaluate(() => window.fixtureStats())).additionalSubmissions).toBe(0);
            if (outcome === 'usdt') {
                const create = panel.getByRole('button', { name: /生成 USDT/ });
                await expect(create).toBeEnabled();
                await create.click();
                await expect(panel).toContainText('等待链上固化到账');
                await expect(panel).toContainText('0.700123 USDT');
                await expect(panel.getByRole('textbox', { name: 'USDT 收款地址' })).toHaveValue(
                    'SYNTHETIC-NOT-A-WALLET',
                );
                await expect(create).toHaveCount(0);
                await panel.getByRole('button', { name: '刷新付款状态' }).click();
                expect((await page.evaluate(() => window.fixtureStats())).usdtRequests).toBe(1);
                expect((await page.evaluate(() => window.fixtureStats())).additionalSubmissions).toBe(0);
                await expect(page.locator('.order-confirmation-hero h1')).toHaveText('订单待补款');
            } else {
                const pay = panel.getByRole('button', { name: /确认使用余额/ });
                await expect(pay).toBeEnabled();
                await pay.click();
                await expect(panel).toContainText('余额抵扣已登记');
                if (outcome === 'wallet-refresh-failure') {
                    await expect(pay).toBeDisabled();
                    await expect(panel).toContainText('剩余金额尚未更新');
                    await page.evaluate(() => window.recoverAdditionalRead());
                    await panel.getByRole('button', { name: '刷新付款状态' }).click();
                }
                await expect(panel.getByRole('button', { name: /确认支付/ })).toBeEnabled();
                await expect(panel).toContainText('¥3');
                const partialStats = await page.evaluate(() => window.fixtureStats());
                expect(partialStats.additionalSubmissions).toBe(1);
                expect(partialStats.additionalRemaining).toBe(300);
            }
            const stats = await page.evaluate(() => window.fixtureStats());
            expect(stats.additionalExpectedAmount).toBe(500);
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
        path.join(output, 'additional-methods-results.json'),
        JSON.stringify({ syntheticOnly: true, results }, null, 2),
    );
    process.stdout.write(format('Additional USDT and partial balance: 6 scenarios passed') + '\n');
} finally {
    await browser.close();
}
