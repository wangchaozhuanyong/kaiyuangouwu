import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../../../tmp/announcements-20261009/browser/', import.meta.url));
await mkdir(output, { recursive: true });
const base = process.env.ANNOUNCEMENTS_PREVIEW_URL || 'http://127.0.0.1:5310/e2e/announcements/index.html';
const browser = await chromium.launch({ headless: true });
const report = {
    source: 'Actual shared components and navigation; synthetic data, no production API',
    cases: [],
    errors: [],
};
const page = await browser.newPage();
page.on('pageerror', error => report.errors.push(error.message));
try {
    for (const skin of (process.env.ANNOUNCEMENT_SKINS || 'classic,neo-minimalist').split(','))
        for (const lang of ['zh', 'en'])
            for (const width of [360, 390, 1440]) {
                const label = `${skin}-${lang}-${width}`;
                const zh = lang === 'zh';
                await page.setViewportSize({ width, height: 900 });
                await page.goto(`${base}?skin=${skin}&lang=${lang}`);
                const rows = page.locator('.notification-list > button');
                await rows.first().waitFor();
                assert.equal(await rows.count(), 12);
                assert.equal(
                    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                    false,
                );
                if (width === 1440) {
                    const header = await page.locator('.proto-header-inner').boundingBox();
                    assert(header.width > 1000, 'Must load production desktop styles');
                }
                await page.screenshot({ path: `${output}/${label}-list.png`, fullPage: true });
                const next = page
                    .locator('.announcement-pagination')
                    .getByRole('button', { name: zh ? '下一页' : 'Next', exact: true });
                await next.click();
                await rows.first().filter({ hasText: /13/ }).waitFor();
                await next.click();
                await rows.first().filter({ hasText: /25/ }).waitFor();
                assert.equal(await rows.count(), 3);
                await rows.last().click();
                await page.locator('.announcement-article h1').filter({ hasText: '27' }).waitFor();
                assert.equal(
                    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                    false,
                );
                await page.screenshot({ path: `${output}/${label}-detail.png`, fullPage: true });
                if (width === 1440)
                    await page
                        .getByRole('button', {
                            name: zh ? '返回全部公告' : 'Back to announcements',
                            exact: true,
                        })
                        .click();
                else await page.locator('.subpage-header button').click();
                await rows.first().filter({ hasText: /25/ }).waitFor();
                report.cases.push({
                    label,
                    status: 'pass',
                    checks: [
                        '12-item page',
                        'older than 20 and two years reachable',
                        'detail',
                        'return preserves page 3',
                        'no horizontal overflow',
                    ],
                });
            }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}?view=account&lang=zh&skin=classic`);
    const grid = page.locator('.account-service-grid');
    await grid.waitFor();
    assert.equal(await grid.getByRole('button').count(), 8);
    assert.equal(await grid.getByRole('button', { name: '店铺首页' }).count(), 0);
    await grid.getByRole('button', { name: '系统公告' }).click();
    await page.locator('.notification-list > button').first().waitFor();
    report.cases.push({ label: 'actual-mobile-account-entry', status: 'pass' });
    for (const state of ['empty', 'error']) {
        await page.goto(`${base}?state=${state}&lang=zh&skin=classic`);
        await page.locator('.empty-state-title').waitFor();
        if (state === 'error') {
            await page.getByRole('button', { name: '重试', exact: true }).click();
            await page.locator('.notification-list > button').first().waitFor();
        } else assert.match(await page.locator('.empty-state-title').innerText(), /暂无系统公告/);
        report.cases.push({ label: state, status: 'pass' });
    }
    await page.goto(`${base}?id=27&lang=en&skin=neo-minimalist`);
    await page.locator('.announcement-article h1').filter({ hasText: '27' }).waitFor();
    await page.reload();
    await page.locator('.announcement-article h1').filter({ hasText: '27' }).waitFor();
    report.cases.push({ label: 'direct-detail-refresh', status: 'pass' });
    await page.goto(`${base}?id=missing&lang=zh&skin=classic`);
    await page.getByRole('heading', { name: '此公告暂不可查看' }).waitFor();
    await page.getByRole('button', { name: '返回全部公告', exact: true }).filter({ visible: true }).click();
    await page.locator('.notification-list > button').first().waitFor();
    report.cases.push({ label: 'unavailable-detail-return', status: 'pass' });
    assert.deepEqual(report.errors, []);
} catch (error) {
    report.failure = String(error.stack || error);
    process.exitCode = 1;
} finally {
    await writeFile(
        `${output}/${process.env.ANNOUNCEMENT_REPORT || 'report'}.json`,
        JSON.stringify(report, null, 2),
    );
    await browser.close();
    process.stdout.write(
        `${JSON.stringify({ cases: report.cases.length, errors: report.errors, failure: report.failure })}\n`,
    );
}
