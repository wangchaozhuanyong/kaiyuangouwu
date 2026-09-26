import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./results/', import.meta.url));
const base = process.env.PREVIEW_TEST_URL ?? 'http://127.0.0.1:5316';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const manager = () => page.getByRole('dialog', { name: '首页轮播图', exact: true });
const editor = () => page.getByRole('dialog', { name: '编辑店铺楼层区块', exact: true });
const frame = () => editor().frameLocator('iframe[title="客户端装修效果"]');
const openEditor = async () => {
    await expect(page.getByRole('article', { name: '首页轮播', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '首页轮播图', exact: true }).click();
    await manager()
        .getByRole('article', { name: '生活好物', exact: true })
        .getByRole('button', { name: '编辑', exact: true })
        .click();
};
const measure = body => {
    const pick = selector => {
        const element = body.ownerDocument.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: box.width,
            height: box.height,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            color: style.color,
            background: style.backgroundColor,
            borderRadius: style.borderRadius,
            objectFit: style.objectFit,
        };
    };
    return {
        preset: body.ownerDocument.documentElement.dataset.storefrontPreset,
        viewport: body.ownerDocument.defaultView.innerWidth,
        hero: pick('.hero'),
        title: pick('.hero-rich-title'),
        image: pick('.hero img'),
        header: pick('header'),
        product: pick('article'),
    };
};
const compare = (client, preview) => {
    expect(preview.viewport).toBe(client.viewport);
    expect(preview.preset).toBe(client.preset);
    for (const key of ['hero', 'title', 'image', 'header', 'product']) {
        const { width, height, ...styles } = preview[key];
        const { width: clientWidth, height: clientHeight, ...clientStyles } = client[key];
        expect(styles).toEqual(clientStyles);
        // Transformed iframe text rasterization can round intrinsic line boxes by subpixels.
        expect(Math.abs(width - clientWidth)).toBeLessThan(1);
        expect(Math.abs(height - clientHeight)).toBeLessThan(1);
    }
};
try {
    await page.goto(`${base}/e2e/carousel/index.html?parity&persist&preset=modern-oriental`);
    await openEditor();
    await editor().getByRole('button', { name: '电脑', exact: true }).click();
    await editor().getByRole('textbox', { name: '中文标题 *', exact: true }).fill('装修即时预览验证');
    await expect(frame().locator('.hero-rich-title')).toHaveText('装修即时预览验证');
    await expect(frame().locator('html')).toHaveAttribute('data-storefront-preset', 'modern-oriental');
    await editor().getByRole('button', { name: '从素材库选择', exact: true }).click();
    await page
        .getByRole('dialog', { name: '选择图片素材' })
        .getByRole('button', { name: /替换轮播横幅/ })
        .click();
    await expect(frame().locator('.hero img')).toHaveAttribute('src', '/assets/replacement-carousel.svg');
    await expect(frame().locator('.hero img')).toHaveJSProperty('naturalWidth', 1600);

    const client = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    await client.goto(`${base}/?parityClient&preset=modern-oriental`);
    await expect(client.locator('.hero-rich-title')).toHaveText('装修即时预览验证');
    await expect(client.locator('html')).toHaveAttribute('data-storefront-preset', 'modern-oriental');
    const desktop = {
        client: await client.locator('body').evaluate(measure),
        preview: await frame().locator('body').evaluate(measure),
    };
    compare(desktop.client, desktop.preview);
    await editor().getByRole('button', { name: '手机', exact: true }).click();
    await client.setViewportSize({ width: 390, height: 844 });
    await expect(client.locator('.hero img')).toHaveCSS('object-fit', 'cover');
    await expect(frame().locator('.hero img')).toHaveCSS('object-fit', 'cover');
    const mobile = {
        client: await client.locator('body').evaluate(measure),
        preview: await frame().locator('body').evaluate(measure),
    };
    compare(mobile.client, mobile.preview);
    await writeFile(`${output}/hero-client-parity.json`, JSON.stringify({ desktop, mobile }, null, 2));
    await editor().getByRole('button', { name: '放大预览', exact: true }).click();
    const expanded = page.getByRole('dialog', { name: '放大客户端装修预览' });
    await expect(expanded.locator('iframe')).toHaveAttribute('width', '390');
    await expanded.getByRole('button', { name: '关闭预览', exact: true }).click();
    await editor().getByRole('button', { name: '保存并核对', exact: true }).click();
    await expect(editor()).toHaveCount(0);
    await page.reload();
    await openEditor();
    await expect(frame().locator('.hero-rich-title')).toHaveText('装修即时预览验证');
    await expect(frame().locator('.hero img')).toHaveAttribute('src', '/assets/replacement-carousel.svg');
    expect(errors).toEqual([]);
    process.stdout.write(
        'Client desktop/mobile parity, live draft, asset replacement, save/reload and expansion passed.\n',
    );
} finally {
    await browser.close();
}
