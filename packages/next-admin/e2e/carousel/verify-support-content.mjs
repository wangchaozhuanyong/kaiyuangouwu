import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const supportCard = () => page.getByRole('article').filter({ hasText: '客服中心' }).first();
const editor = () => page.getByRole('dialog', { name: /店铺楼层区块/ });

try {
    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?support&persist');
    await supportCard().getByRole('button', { name: '编辑内容' }).click();
    const image = editor().getByRole('img', { name: '客服页首配图预览' });
    await expect(image).toHaveCSS('object-fit', 'contain');
    await expect(editor().getByRole('region', { name: '常见问题预览' })).toContainText('如何联系客服？');
    await editor().getByRole('textbox', { name: '中文问题 1' }).fill('如何联系商家？');
    await editor().getByRole('button', { name: '从素材库选择' }).first().click();
    await page
        .getByRole('dialog', { name: '选择图片素材' })
        .getByRole('button', { name: /替换轮播横幅/ })
        .click();
    await expect(image).toHaveAttribute('src', /445a78/);
    await expect(editor().getByRole('region', { name: '常见问题预览' })).toContainText('如何联系商家？');
    await editor().getByRole('button', { name: '保存并生效' }).click();
    await expect(editor()).toHaveCount(0);
    const writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminUpdateStorefrontBlock',
        ),
    );
    expect(writes.at(-1).variables.input.imageAssetId).toBe('replacement-asset');
    expect(writes.at(-1).variables.input.settings.supportFaqs[0].questionZh).toBe('如何联系商家？');

    await page.reload();
    await supportCard().getByRole('button', { name: '编辑内容' }).click();
    await expect(editor().getByRole('img', { name: '客服页首配图预览' })).toHaveAttribute('src', /445a78/);
    await expect(editor().getByRole('region', { name: '常见问题预览' })).toContainText('如何联系商家？');
    expect(errors).toEqual([]);
    process.stdout.write('Support artwork and FAQ draft, save, and reload echo passed.\n');
} finally {
    await browser.close();
}
