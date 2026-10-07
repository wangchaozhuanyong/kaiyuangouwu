import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const output = path.join(root, 'artifacts/store-scope-20261007/browser');
const base = process.env.STORE_SCOPE_FIXTURE_URL ?? 'http://127.0.0.1:5327';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
    await page.goto(`${base}/e2e/carousel/index.html?announcements&persist`);
    await page.getByRole('button', { name: '新建公告' }).first().click();
    let editor = page.getByRole('dialog', { name: '新建首页公告' });
    await expect(editor.getByText('仅本店：预览测试店铺')).toBeVisible();
    await expect(editor.getByRole('radio', { name: '全部店铺' })).toHaveCount(0);
    await expect(editor.getByRole('checkbox', { name: '第二测试店铺' })).toHaveCount(0);
    await editor.getByRole('textbox', { name: '中文标题 *' }).fill('本店营业通知');
    await editor.getByRole('textbox', { name: '中文正文 *' }).fill('明日正常营业，仅本店发布。');
    await editor.getByRole('button', { name: '创建公告' }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText('本店营业通知', { exact: true })).toBeVisible();
    let writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(item => item.name === 'NextAdminCreateSystemAnnouncement'),
    );
    expect(writes.at(-1).variables.input).toMatchObject({ targetMode: 'SINGLE', channelIds: ['fixture'] });
    await page.reload();
    await expect(page.getByText('本店营业通知', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(output, 'announcements-store.png'), fullPage: true });

    await page.goto(`${base}/e2e/carousel/index.html?announcements&platform-channel`);
    await page.getByRole('button', { name: '新建公告' }).first().click();
    editor = page.getByRole('dialog', { name: '新建首页公告' });
    await expect(editor.getByRole('radio', { name: '全部店铺' })).toBeVisible();
    await editor.getByRole('radio', { name: '全部店铺' }).check();
    await editor.getByRole('textbox', { name: '中文标题 *' }).fill('平台全店通知');
    await editor.getByRole('textbox', { name: '中文正文 *' }).fill('平台统一维护。');
    await editor.getByRole('button', { name: '创建公告' }).click();
    await expect(editor).toHaveCount(0);
    writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(item => item.name === 'NextAdminCreateSystemAnnouncement'),
    );
    expect(writes.at(-1).variables.input).toMatchObject({ targetMode: 'ALL', channelIds: [] });

    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(`${base}/e2e/carousel/index.html?announcements&persist&readonly`);
    await expect(page.getByText('本店营业通知', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建公告' }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'announcements-readonly-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    const report = {
        status: 'PASS',
        fixtureOnly: true,
        productionDataUsed: false,
        scenarios: ['store-own-create-reload', 'platform-all-create', 'mobile-readonly-no-write-no-overflow'],
        errors,
    };
    await writeFile(path.join(output, 'announcement-browser.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write('Store announcement scope: 3 browser scenarios passed (isolated fixture).\n');
} finally {
    await browser.close();
}
