import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixtureData } from '../../../storefront/e2e/visual-presets/fixtures.mjs';

const output = fileURLToPath(new URL('../../artifacts/visual-presets/', import.meta.url));
const base = process.env.PREVIEW_TEST_URL ?? 'http://127.0.0.1:5187';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settings = () => page.getByRole('dialog', { name: '商城装修设置', exact: true });
const panel = () => settings().getByRole('region', { name: '店铺皮肤', exact: true });
const radio = preset => panel().locator(`input[value="${preset}"]`);
const open = async (waitForReady = true) => {
    await page.getByRole('button', { name: '装修设置', exact: true }).click();
    if (waitForReady) await expect(radio('classic')).toBeEnabled();
};
const close = async () => {
    await settings().getByRole('button', { name: '关闭装修设置', exact: true }).click();
};
const save = () => panel().getByRole('button', { name: '保存到当前店铺', exact: true }).click();
const reload = () => panel().getByRole('button', { name: '重新读取', exact: true }).click();
const preview = async (preset, narrow = false) => {
    await panel().getByRole('button', { name: '预览效果', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '店铺皮肤效果预览', exact: true });
    const frame = modal.frameLocator('iframe[title="客户端装修效果"]');
    for (const [label, width] of [
        ['手机', 390],
        ['电脑', 1440],
    ]) {
        await modal.getByRole('button', { name: label, exact: true }).click();
        await expect(frame.locator('html')).toHaveAttribute('data-storefront-preset', preset);
        await expect
            .poll(() => frame.locator('html').evaluate(el => el.ownerDocument.defaultView.innerWidth))
            .toBe(width);
        await expect
            .poll(() =>
                frame
                    .locator('html')
                    .evaluate(el => getComputedStyle(el).getPropertyValue('--skin-control-radius').trim()),
            )
            .toBe('10px');
        await expect
            .poll(() =>
                frame.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--bg').trim()),
            )
            .toBe(preset === 'classic' ? '#f1f5f9' : '#070b14');
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
        await page.screenshot({
            path: `${output}/admin-${preset}-${label}-${narrow ? 'narrow' : 'wide'}.png`,
            fullPage: true,
            animations: 'disabled',
        });
    }
    await modal.getByRole('button', { name: '关闭预览', exact: true }).click();
};
try {
    await page.route('https://fixture.invalid/shop-api**', async route => {
        const channelId = await page.getByRole('combobox', { name: '测试店铺' }).inputValue();
        const presetId = await page.getByTestId('persisted-preset').textContent();
        const data = fixtureData(presetId, false, 'normal');
        data.activeChannel = {
            ...data.activeChannel,
            id: channelId,
            code: channelId === 'a' ? '测试店铺 A' : '测试店铺 B',
        };
        data.storefrontVisualPreset.channelId = channelId;
        await route.fulfill({
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ data }),
        });
    });
    await page.goto(`${base}/e2e/visual-presets/index.html`);
    await open();
    await expect(radio('classic')).toBeChecked();
    await radio('neo-minimalist').check();
    await preview('neo-minimalist');
    await expect(page.getByTestId('save-count')).toHaveText('0');
    await expect(page.getByTestId('persisted-preset')).toHaveText('classic');
    await save();
    await expect(panel().getByRole('status').filter({ hasText: '已保存到当前店铺' })).toBeVisible();
    await expect(page.getByTestId('save-count')).toHaveText('1');
    await reload();
    await expect(radio('neo-minimalist')).toBeChecked();
    await close();
    await page.getByRole('combobox', { name: '测试店铺' }).selectOption('b');
    await open();
    await expect(radio('classic')).toBeChecked();
    await close();
    await page.getByRole('combobox', { name: '测试店铺' }).selectOption('a');
    await open();
    await expect(radio('neo-minimalist')).toBeChecked();
    await panel().getByRole('button', { name: '恢复默认皮肤（保存后生效）', exact: true }).click();
    await expect(page.getByTestId('persisted-preset')).toHaveText('neo-minimalist');
    await save();
    await expect(page.getByTestId('persisted-preset')).toHaveText('classic');
    await close();
    await page.getByRole('checkbox', { name: '模拟保存冲突' }).check();
    await open();
    await radio('neo-minimalist').check();
    await save();
    await expect(panel().getByRole('alert')).toContainText('其他管理员');
    await expect(page.getByTestId('persisted-preset')).toHaveText('classic');
    await expect(radio('neo-minimalist')).toBeChecked();
    await reload();
    await expect(radio('classic')).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await preview('classic', true);
    await close();
    await page.getByRole('checkbox', { name: '模拟保存冲突' }).uncheck();
    // A failed verification read must not repeat or silently revert the committed write.
    await page.getByRole('checkbox', { name: '模拟回读失败' }).check();
    await open();
    await radio('neo-minimalist').check();
    await save();
    await expect(panel().getByRole('alert')).toContainText('回读失败');
    await expect(page.getByTestId('persisted-preset')).toHaveText('neo-minimalist');
    await expect(radio('neo-minimalist')).toBeChecked();
    await page.screenshot({ path: `${output}/admin-saved-readback-failed.png`, fullPage: true });
    await close();
    await page.getByRole('checkbox', { name: '模拟回读失败' }).uncheck();
    await open(false);
    await reload();
    await expect(panel().getByRole('alert')).toHaveCount(0);
    await radio('classic').check();
    await save();
    await expect(page.getByTestId('persisted-preset')).toHaveText('classic');
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/admin-result.json`,
        JSON.stringify(
            {
                passed: true,
                checks: [
                    'two skin drafts',
                    'mobile and desktop viewport',
                    'preview does not save',
                    'save and readback',
                    'store isolation',
                    'explicit reset save',
                    'conflict preserves draft',
                    'narrow admin viewport',
                    'write survives readback failure',
                    'recovery',
                ],
                errors,
            },
            null,
            2,
        ),
    );
    console.log('Admin visual preset browser checks passed');
} catch (error) {
    await page.screenshot({ path: `${output}/admin-failure.png`, fullPage: true });
    console.error(errors);
    throw error;
} finally {
    await browser.close();
}
