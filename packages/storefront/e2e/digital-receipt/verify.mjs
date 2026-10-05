import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'artifacts/digital-receipt/closure-20261004');
const origin = 'http://127.0.0.1:5193';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
    for (const width of [390, 1440])
        for (const language of ['zh', 'en'])
            for (const preset of ['classic', 'neo-minimalist']) {
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
                    if (url.pathname.startsWith('/digital-delivery/'))
                        return route.fulfill({ body: 'Synthetic file. No production content.' });
                    return route.continue();
                });
                const scenario = `${width}-${language}-${preset}`;
                await page.goto(
                    `${origin}/e2e/digital-receipt/index.html?page=confirmation&language=${language}&preset=${preset}`,
                );
                const panel = page.getByRole('region', {
                    name: language === 'zh' ? '领取数字商品' : 'Claim digital products',
                });
                await expect(
                    panel.getByRole('button', {
                        name: language === 'zh' ? '领取内容' : 'Claim content',
                        exact: true,
                    }),
                ).toHaveCount(3);
                expect((await page.evaluate(() => window.fixtureStats())).claimCount).toBe(0);
                expect(await panel.textContent()).not.toContain('dummy-private-content');
                await panel
                    .getByRole('button', {
                        name: language === 'zh' ? '领取内容' : 'Claim content',
                        exact: true,
                    })
                    .first()
                    .click();
                await expect(panel).toContainText('dummy-private-content');
                expect((await page.evaluate(() => window.fixtureStats())).cacheContainsContent).toBe(false);
                await panel
                    .getByRole('button', {
                        name: language === 'zh' ? '领取内容' : 'Claim content',
                        exact: true,
                    })
                    .last()
                    .click();
                await expect(
                    panel.getByRole('link', {
                        name: language === 'zh' ? '下载成交时的文件' : 'Download your purchased version',
                    }),
                ).toHaveAttribute('href', '/digital-delivery/synthetic-file-token');
                await panel.scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(output, `claimed-${scenario}.png`), fullPage: true });
                const dimensions = await page.evaluate(() => ({
                    viewport: innerWidth,
                    document: document.documentElement.scrollWidth,
                    body: document.body.scrollWidth,
                }));
                expect(dimensions.document).toBeLessThanOrEqual(width);
                expect(dimensions.body).toBeLessThanOrEqual(width);
                await page.getByRole('button', { name: 'Synthetic switch proof' }).click();
                await expect(panel).not.toContainText('dummy-private-content');
                await panel
                    .getByRole('button', {
                        name: language === 'zh' ? '查看已领取内容' : 'View claimed content',
                        exact: true,
                    })
                    .first()
                    .click();
                await expect(panel).toContainText('dummy-private-content');
                await page.getByRole('button', { name: 'Synthetic revoke' }).click();
                await expect(panel).toContainText(
                    language === 'zh' ? '资格已暂停或停止' : 'Access is paused or stopped',
                );
                await expect(panel).not.toContainText('dummy-private-content');
                await expect(panel.locator('button')).toHaveCount(0);
                const stats = await page.evaluate(() => window.fixtureStats());
                expect(stats.proofMatched).toBe(true);
                expect(stats.claimCount).toBe(2);
                expect(errors).toEqual([]);
                expect(external).toEqual([]);
                results.push({
                    scenario,
                    page: 'OrderConfirmationPage',
                    dimensions,
                    stats,
                    errors,
                    external,
                    result: 'PASS',
                });
                await page.goto(
                    `${origin}/e2e/digital-receipt/index.html?page=detail&language=${language}&preset=${preset}`,
                );
                await expect(
                    panel.getByRole('button', {
                        name: language === 'zh' ? '领取内容' : 'Claim content',
                        exact: true,
                    }),
                ).toHaveCount(3);
                await panel
                    .getByRole('button', {
                        name: language === 'zh' ? '领取内容' : 'Claim content',
                        exact: true,
                    })
                    .first()
                    .click();
                await expect(panel).toContainText('dummy-private-content');
                await page.getByRole('button', { name: 'Synthetic read failure' }).click();
                await expect
                    .poll(async () => (await page.evaluate(() => window.fixtureStats())).readFailures)
                    .toBeGreaterThan(0);
                await expect(panel).toContainText('dummy-private-content');
                await expect(panel).toContainText(
                    language === 'zh' ? '已领取，内容显示在下方' : 'Claimed. Your content is shown below.',
                );
                await panel.scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(output, `detail-${scenario}.png`), fullPage: true });
                const detailDimensions = await page.evaluate(() => ({
                    viewport: innerWidth,
                    document: document.documentElement.scrollWidth,
                    body: document.body.scrollWidth,
                }));
                expect(detailDimensions.document).toBeLessThanOrEqual(width);
                expect(detailDimensions.body).toBeLessThanOrEqual(width);
                expect(errors).toEqual([]);
                expect(external).toEqual([]);
                results.push({
                    scenario,
                    page: 'OrderDetailPage',
                    dimensions: detailDimensions,
                    errors,
                    external,
                    result: 'PASS',
                });
                await context.close();
            }
    await writeFile(
        path.join(output, 'results.json'),
        JSON.stringify(
            {
                synthetic: true,
                realSMTP: 'NOT_MEASURED',
                realFunds: 'NOT_MEASURED',
                realReceipt: 'NOT_MEASURED',
                scenarios: results,
            },
            null,
            2,
        ) + '\n',
    );
    process.stdout.write(
        `Synthetic digital receipt browser acceptance passed: ${results.length} page scenarios\n`,
    );
} finally {
    await browser.close();
}
