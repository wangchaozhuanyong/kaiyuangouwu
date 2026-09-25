import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const panel = () => page.getByRole('region', { name: '电脑端分类横幅' });

try {
    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?banner&persist');
    await expect(panel()).toBeVisible();
    await panel().getByRole('combobox', { name: '横幅展示方式' }).selectOption('image');
    await panel().getByRole('button', { name: '从素材库选择' }).click();
    await page
        .getByRole('dialog', { name: '选择图片素材' })
        .getByRole('button', { name: /替换轮播横幅/ })
        .click();
    const image = panel().getByRole('img', { name: '分类横幅图片预览' });
    await expect(image).toHaveAttribute('src', /445a78/);
    await expect(image).toHaveCSS('object-fit', 'contain');
    await panel().getByRole('button', { name: '保存分类横幅' }).click();
    await expect(panel().getByRole('status')).toContainText('分类横幅已保存到当前店铺');
    const writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminCreateStorefrontBlock',
        ),
    );
    expect(writes.at(-1).variables.input).toMatchObject({
        code: 'desktop-category-banner-default',
        imageAssetId: 'replacement-asset',
        settings: { purpose: 'desktop-category-banner', categoryId: 'default', mode: 'image' },
    });

    await page.reload();
    await expect(panel().getByRole('combobox', { name: '横幅展示方式' })).toHaveValue('image');
    await expect(panel().getByRole('img', { name: '分类横幅图片预览' })).toHaveAttribute('src', /445a78/);
    expect(errors).toEqual([]);
    process.stdout.write('Category banner artwork, save, and reload echo passed.\n');
} finally {
    await browser.close();
}
