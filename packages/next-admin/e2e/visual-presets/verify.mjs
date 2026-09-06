import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('artifacts/visual-presets');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
    await page.goto('http://127.0.0.1:5187/e2e/visual-presets/index.html');
    await expect(page.getByRole('heading', { name: /^店铺皮肤/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /现有皮肤/ })).toBeChecked();
    await page.getByRole('radio', { name: /现代东方/ }).check();
    await page.getByRole('button', { name: '预览效果', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '店铺皮肤效果预览' })).toBeVisible();
    const frame = page.frameLocator('iframe[title="皮肤组件预览"]');
    await expect(frame.locator('html')).toHaveAttribute('data-storefront-preset', 'modern-oriental');
    await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(246, 242, 234)');
    await expect(frame.locator('.hero-rich-cta-btn')).toHaveCSS('background-color', 'rgb(166, 61, 50)');
    await expect(page.getByTestId('save-count')).toHaveText('0');
    await page.screenshot({
        path: `${output}/admin-mobile-preview.png`,
        fullPage: true,
        animations: 'disabled',
    });
    await page
        .getByRole('dialog', { name: '店铺皮肤效果预览' })
        .getByRole('button', { name: '电脑', exact: true })
        .click();
    await page.screenshot({
        path: `${output}/admin-desktop-preview.png`,
        fullPage: true,
        animations: 'disabled',
    });
    await page.getByRole('button', { name: '关闭预览' }).click();
    await page.getByRole('button', { name: '应用到当前店铺' }).click();
    await expect(page.getByRole('region', { name: '店铺皮肤' }).getByRole('status')).toContainText(
        '已应用现代东方',
    );
    await expect(page.getByTestId('save-count')).toHaveText('1');
    await page.getByRole('button', { name: '重新载入' }).click();
    await expect(page.getByRole('radio', { name: /现代东方/ })).toBeChecked();
    await page.getByRole('combobox', { name: '测试店铺' }).selectOption('b');
    await expect(page.getByRole('radio', { name: /现有皮肤/ })).toBeChecked();
    await page.getByRole('combobox', { name: '测试店铺' }).selectOption('a');
    await expect(page.getByRole('radio', { name: /现代东方/ })).toBeChecked();
    await page.screenshot({
        path: `${output}/admin-skin-selector.png`,
        fullPage: true,
        animations: 'disabled',
    });
    await page.getByRole('button', { name: '恢复默认皮肤' }).click();
    await expect(page.getByRole('region', { name: '店铺皮肤' }).getByRole('status')).toContainText(
        '已应用现有皮肤',
    );
    await page.getByRole('checkbox', { name: '模拟保存冲突' }).check();
    await page.getByRole('radio', { name: /现代东方/ }).check();
    await page.getByRole('button', { name: '应用到当前店铺' }).click();
    await expect(page.getByRole('alert')).toContainText('其他管理员');
    await page.getByRole('button', { name: '重新载入' }).click();
    await expect(page.getByRole('radio', { name: /现有皮肤/ })).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
        path: `${output}/admin-mobile-selector.png`,
        fullPage: true,
        animations: 'disabled',
    });
    // Keep the target iframe viewport on narrow admin screens, without saving the preview.
    await page.getByRole('button', { name: '预览效果', exact: true }).click();
    await expect
        .poll(() => frame.locator('html').evaluate(el => el.ownerDocument.defaultView.innerWidth))
        .toBe(390);
    await page
        .getByRole('dialog', { name: '店铺皮肤效果预览' })
        .getByRole('button', { name: '电脑', exact: true })
        .click();
    await expect
        .poll(() => frame.locator('html').evaluate(el => el.ownerDocument.defaultView.innerWidth))
        .toBe(1200);
    await expect
        .poll(() =>
            frame
                .locator('.preview-grid')
                .evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length),
        )
        .toBe(2);
    const scroller = page.locator('iframe[title="皮肤组件预览"]').locator('..');
    await expect
        .poll(() =>
            scroller.evaluate(el => {
                el.scrollLeft = 300;
                return el.scrollLeft;
            }),
        )
        .toBeGreaterThan(0);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await page.screenshot({
        path: `${output}/admin-desktop-preview-on-mobile.png`,
        fullPage: true,
        animations: 'disabled',
    });
    await page.getByRole('button', { name: '关闭预览' }).click();

    // A successful write stays current when the verification read fails.
    await page.getByRole('checkbox', { name: '模拟保存冲突' }).uncheck();
    await expect(page.getByRole('radio', { name: /现有皮肤/ })).toBeChecked();
    await page.getByRole('checkbox', { name: '模拟回读失败' }).check();
    await page.getByRole('radio', { name: /现代东方/ }).check();
    await page.getByRole('button', { name: '应用到当前店铺' }).click();
    await expect(page.getByRole('alert')).toContainText('皮肤已保存，但重新读取失败');
    await expect(page.getByTestId('persisted-preset')).toHaveText('modern-oriental');
    await expect(page.getByRole('radio', { name: /现代东方 当前使用/ })).toBeChecked();
    await expect(page.getByRole('region', { name: '店铺皮肤' }).getByRole('status')).toContainText(
        '已应用现代东方',
    );
    await page.screenshot({
        path: `${output}/admin-saved-readback-failed.png`,
        fullPage: true,
        animations: 'disabled',
    });
    await page.getByRole('checkbox', { name: '模拟回读失败' }).uncheck();
    await page.getByRole('button', { name: '重新载入' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '恢复默认皮肤' })).toBeEnabled();
    await page.getByRole('button', { name: '恢复默认皮肤' }).click();
    await expect(page.getByRole('radio', { name: /现有皮肤 当前使用/ })).toBeChecked();
    await expect(page.getByTestId('persisted-preset')).toHaveText('classic');
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/admin-result.json`,
        JSON.stringify(
            {
                passed: true,
                checks: [
                    'preview does not save',
                    'shared CSS mobile and desktop',
                    'apply and read back',
                    'store isolation',
                    'restore classic',
                    'conflict retained safely',
                    'desktop viewport on mobile',
                    'committed write retained after failed readback',
                    'recovery and reset after readback failure',
                ],
                errors,
            },
            null,
            2,
        ),
    );
    console.log('Admin visual preset browser checks passed');
} catch (error) {
    await page.screenshot({ path: `${output}/admin-failure.png`, fullPage: true, animations: 'disabled' });
    console.error(errors);
    throw error;
} finally {
    await browser.close();
}
