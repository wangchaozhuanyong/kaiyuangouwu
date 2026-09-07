import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base =
    process.env.AI_PROVIDER_TEST_URL ?? 'http://127.0.0.1:5297/e2e/ai-image/index.html?page=provider';
const output = path.join(tmpdir(), 'codex-ai-provider-access-20260907');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const providerRow = name =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

try {
    await page.goto(base);
    await expect(page.getByRole('heading', { name: /^AI 服务商接入/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '设置修改', exact: true })).toHaveCount(2);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, 'provider-list-desktop.png'), fullPage: true });

    const openAiRow = providerRow('OpenAI 主用服务商');
    const openAiButton = openAiRow.getByRole('button', { name: '设置修改' });
    await openAiButton.click();
    const openAiDrawer = page.getByRole('dialog', {
        name: '设置服务商：OpenAI 主用服务商',
        exact: true,
    });
    await expect(openAiDrawer).toBeVisible();
    const drawerBox = await openAiDrawer.locator('> div').boundingBox();
    expect(drawerBox.width).toBeLessThanOrEqual(672);
    expect(drawerBox.x).toBeGreaterThan(700);
    await expect(openAiDrawer.getByLabel('API Base URL *')).toHaveValue('https://api.example.com/v1');
    await expect(openAiDrawer.getByRole('button', { name: '测试连通性' })).toBeEnabled();
    await expect(openAiDrawer.getByRole('button', { name: '保存凭据' })).toBeDisabled();
    await page.screenshot({ path: path.join(output, 'provider-drawer-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(openAiDrawer).toHaveCount(0);
    await expect(openAiButton).toBeFocused();

    const geminiRow = providerRow('Gemini 主用服务商');
    await geminiRow.getByRole('button', { name: '设置修改' }).click();
    const geminiDrawer = page.getByRole('dialog', {
        name: '设置服务商：Gemini 主用服务商',
        exact: true,
    });
    await expect(geminiDrawer.getByRole('button', { name: '保存凭据' })).toBeDisabled();
    await geminiDrawer.getByLabel('API Key *').fill('fixture-api-5678');
    await expect(geminiDrawer.getByRole('button', { name: '保存凭据' })).toBeEnabled();
    await geminiDrawer.getByRole('button', { name: '保存凭据' }).click();
    await expect(geminiDrawer).toHaveCount(0);
    await expect(geminiRow).toContainText('密钥已配置 · 5678');

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await openAiRow.getByRole('button', { name: '设置修改' }).click();
    await expect(openAiDrawer.getByLabel('提示词优化模型 ID *')).toBeVisible();
    expect(await openAiDrawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, 'provider-drawer-mobile.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(output, 'provider-drawer-mobile-dark.png'), fullPage: true });

    expect(pageErrors).toEqual([]);
    console.log('PASS: AI provider settings list and right-side drawer verified');
    console.log('Screenshots: ' + output);
} finally {
    await browser.close();
}
