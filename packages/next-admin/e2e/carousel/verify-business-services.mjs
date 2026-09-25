import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('e2e/carousel/results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?services&services-disabled&persist');
    await expect(page.getByRole('heading', { name: '商业服务页文案' })).toBeVisible();
    const image = page.getByRole('img', { name: '商业服务页首配图预览' });
    await expect(image).toHaveCSS('object-fit', 'contain');
    const layout = await image.evaluate(element => {
        const card = element.parentElement;
        const heading = card.querySelector('h3');
        return {
            imageLeft: element.getBoundingClientRect().left,
            headingLeft: heading.getBoundingClientRect().left,
            imageWidth: element.naturalWidth,
            imageHeight: element.naturalHeight,
            columns: getComputedStyle(card).gridTemplateColumns.split(' ').length,
        };
    });
    expect(layout.imageLeft).toBeGreaterThan(layout.headingLeft);
    expect(layout.columns).toBe(2);
    expect([layout.imageWidth, layout.imageHeight]).toEqual([1600, 520]);
    await image.locator('..').screenshot({ path: `${output}/business-services-preview.png` });

    await page.getByRole('textbox', { name: /标题.*\/40/ }).fill('本地测试服务');
    await page.getByRole('textbox', { name: '跳转链接地址（可选）' }).fill('https://example.com/services');
    await expect(page.getByText('打开服务网站', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '从素材库选择' }).click();
    await page
        .getByRole('dialog', { name: '选择图片素材' })
        .getByRole('button', { name: /替换轮播横幅/ })
        .click();
    await expect(image).toHaveAttribute('src', /445a78/);
    await expect(page.getByRole('heading', { name: '本地测试服务' })).toBeVisible();
    await page.getByRole('button', { name: '保存并发布' }).click();
    await expect(page.getByRole('status')).toContainText('已保存到当前店铺');
    const writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminUpdateStorefrontBlock',
        ),
    );
    expect(writes.at(-1).variables.input).toMatchObject({
        enabled: true,
        imageAssetId: 'replacement-asset',
        imageUrl: null,
        targetType: 'URL',
        targetValue: 'https://example.com/services',
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: '本地测试服务' })).toBeVisible();
    await expect(image).toHaveAttribute('src', /445a78/);
    await expect(page.getByRole('textbox', { name: '跳转链接地址（可选）' })).toHaveValue(
        'https://example.com/services',
    );
    expect(
        await page.evaluate(
            () => window.carouselFixture.state().blocks.find(block => block.id === 'services-copy')?.enabled,
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
    process.stdout.write('Business services artwork, copy, link, publishing, and reload echo passed.\n');
} finally {
    await browser.close();
}
