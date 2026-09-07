import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = process.env.AI_IMAGE_TEST_URL ?? 'http://127.0.0.1:5297/e2e/ai-image/index.html';
const output = path.join(tmpdir(), 'codex-ai-image-settings-20260907');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const settingRow = name =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name: new RegExp('^' + name) }) });

try {
    await page.goto(base);
    await expect(page.getByRole('heading', { name: /^AI 图片工坊管理/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '设置修改', exact: true })).toHaveCount(4);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, 'settings-list-desktop.png'), fullPage: true });

    await settingRow('店铺服务开关').getByRole('button', { name: '设置修改' }).click();
    const serviceDrawer = page.getByRole('dialog', { name: '店铺服务开关', exact: true });
    await expect(serviceDrawer).toBeVisible();
    const serviceBox = await serviceDrawer.locator('> div').boundingBox();
    expect(serviceBox.width).toBeLessThanOrEqual(672);
    expect(serviceBox.x).toBeGreaterThan(700);
    await serviceDrawer.getByRole('checkbox', { name: /提示词自动优化/ }).uncheck();
    await serviceDrawer.getByRole('button', { name: '保存服务设置' }).click();
    await expect(serviceDrawer).toHaveCount(0);
    await expect(settingRow('店铺服务开关')).toContainText('提示词优化已关闭');

    await settingRow('Gemini 闪电').getByRole('button', { name: '设置修改' }).click();
    const modelDrawer = page.getByRole('dialog', { name: '设置模型：Gemini 闪电', exact: true });
    await expect(modelDrawer.getByRole('textbox', { name: '服务商模型 ID' })).toBeVisible();
    await expect(modelDrawer.getByRole('button', { name: '保存模型' })).toBeDisabled();
    await page.screenshot({ path: path.join(output, 'model-drawer-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(modelDrawer).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await settingRow('买家服务条款与免责声明').getByRole('button', { name: '设置修改' }).click();
    const termsDrawer = page.getByRole('dialog', {
        name: '买家服务条款与免责声明',
        exact: true,
    });
    await expect(termsDrawer.getByRole('textbox', { name: '中文条款 *' })).toBeVisible();
    expect(await termsDrawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, 'terms-drawer-mobile.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(output, 'terms-drawer-mobile-dark.png'), fullPage: true });
    expect(pageErrors).toEqual([]);
    console.log('PASS: AI image settings list and right-side drawers verified');
    console.log('Screenshots: ' + output);
} finally {
    await browser.close();
}
