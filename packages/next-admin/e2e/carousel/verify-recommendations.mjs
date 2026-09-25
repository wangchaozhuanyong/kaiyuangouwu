import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const row = () =>
    page.getByRole('region', { name: '首页楼层' }).getByRole('article', { name: '猜你喜欢', exact: true });

try {
    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?recommendations&persist');
    await expect(row()).toContainText('前台标题：猜你喜欢');
    await row().getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: /店铺楼层区块/ });
    await editor.getByRole('textbox', { name: '中文标题 *' }).fill('本地推荐入口');
    await editor.getByRole('button', { name: '保存并生效' }).click();
    await expect(editor).toHaveCount(0);
    await expect(row()).toContainText('前台标题：本地推荐入口');
    const writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminUpdateStorefrontBlock',
        ),
    );
    expect(writes.at(-1).variables.input.translations).toContainEqual(
        expect.objectContaining({ languageCode: 'zh_Hans', title: '本地推荐入口' }),
    );

    await page.reload();
    await expect(row()).toContainText('前台标题：本地推荐入口');
    expect(errors).toEqual([]);
    process.stdout.write('Recommendation entrance copy, save, and reload echo passed.\n');
} finally {
    await browser.close();
}
