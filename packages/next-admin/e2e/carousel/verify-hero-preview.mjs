import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('e2e/carousel/results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const manager = () => page.getByRole('dialog', { name: '首页轮播图', exact: true });
const editor = () => page.getByRole('dialog', { name: /店铺楼层区块/ });
const frame = () => editor().frameLocator('iframe[title="首页轮播效果"]');

try {
    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?persist&preset=modern-oriental');
    await page.getByRole('button', { name: '首页轮播图', exact: true }).click();
    await manager()
        .getByRole('article', { name: '生活好物', exact: true })
        .getByRole('button', { name: '编辑', exact: true })
        .click();
    await expect(frame().locator('.hero-rich-title')).toHaveText('生活好物');
    await expect(frame().locator('img')).toHaveCSS('object-fit', 'contain');
    await expect(frame().locator('img')).toHaveJSProperty('naturalWidth', 1600);
    await expect(frame().locator('img')).toHaveJSProperty('naturalHeight', 520);
    await editor().getByRole('button', { name: '电脑', exact: true }).click();
    await expect(frame().locator('.hero.hero-image-overlay')).toBeVisible();
    await expect(frame().locator('html')).toHaveAttribute('data-storefront-preset', 'modern-oriental');
    const geometry = await frame()
        .locator('.hero')
        .evaluate(hero => {
            const image = hero.querySelector('img');
            const title = hero.querySelector('.hero-rich-title');
            const copy = hero.querySelector('.hero-rich-content');
            const bounds = hero.getBoundingClientRect();
            const imageBounds = image.getBoundingClientRect();
            const copyBounds = copy.getBoundingClientRect();
            return {
                width: bounds.width,
                height: bounds.height,
                imageWidth: imageBounds.width,
                imageHeight: imageBounds.height,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                fit: getComputedStyle(image).objectFit,
                titleSize: getComputedStyle(title).fontSize,
                copyBackground: getComputedStyle(copy).backgroundColor,
                skinAccent: getComputedStyle(hero.ownerDocument.documentElement)
                    .getPropertyValue('--skin-hero-accent')
                    .trim(),
                storeBackground: getComputedStyle(hero.ownerDocument.body)
                    .getPropertyValue('--store-background')
                    .trim(),
                copyInsideImage:
                    copyBounds.left >= imageBounds.left &&
                    copyBounds.right <= imageBounds.right &&
                    copyBounds.top >= imageBounds.top &&
                    copyBounds.bottom <= imageBounds.bottom,
            };
        });
    expect(geometry).toMatchObject({
        width: 850,
        naturalWidth: 1600,
        naturalHeight: 520,
        fit: 'cover',
        titleSize: '27px',
        copyBackground: 'rgba(0, 0, 0, 0)',
        copyInsideImage: true,
    });
    expect(geometry.skinAccent).toBe('#9f3b30');
    expect(geometry.storeBackground).toBeTruthy();
    expect(geometry.height).toBe(Math.ceil((850 * 520) / 1600));
    expect(geometry.imageWidth).toBe(geometry.width);
    expect(geometry.imageHeight).toBe(geometry.height);
    await editor().getByRole('button', { name: '放大预览' }).click();
    const expanded = page.getByRole('dialog', { name: '放大轮播效果预览' });
    await expect(expanded).toBeVisible();
    await expect(expanded.locator('iframe')).toHaveAttribute('width', '1024');
    await expanded
        .frameLocator('iframe[title="放大首页轮播效果"]')
        .locator('body')
        .screenshot({ path: `${output}/hero-preview-desktop.png` });
    await expanded.getByRole('button', { name: '关闭预览' }).click();
    await expect(expanded).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await editor().getByRole('button', { name: '放大预览' }).click();
    await expect(expanded).toBeVisible();
    expect(await expanded.evaluate(dialog => dialog.getBoundingClientRect().width)).toBe(390);
    await page.keyboard.press('Escape');
    await expect(expanded).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });

    await editor().getByRole('button', { name: '从素材库选择' }).first().click();
    await page
        .getByRole('dialog', { name: '选择图片素材' })
        .getByRole('button', { name: /替换轮播横幅/ })
        .click();
    await expect(editor().getByText('替换轮播横幅', { exact: true })).toBeVisible();
    await expect(frame().locator('img')).toHaveAttribute('src', /445a78/);
    await expect
        .poll(() =>
            frame()
                .locator('img')
                .evaluate(image => image.naturalWidth),
        )
        .toBe(1600);
    await editor().getByRole('button', { name: '保存并生效' }).click();
    await expect(editor()).toHaveCount(0);
    const writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminUpdateStorefrontBlock',
        ),
    );
    expect(writes.at(-1).variables.input).toMatchObject({
        imageAssetId: 'replacement-asset',
        imageUrl: null,
    });

    await page.reload();
    await page.getByRole('button', { name: '首页轮播图', exact: true }).click();
    await manager()
        .getByRole('article', { name: '生活好物', exact: true })
        .getByRole('button', { name: '编辑', exact: true })
        .click();
    await expect(editor().getByText('替换轮播横幅', { exact: true })).toBeVisible();
    await editor().getByRole('button', { name: '电脑', exact: true }).click();
    await expect(frame().locator('img')).toHaveAttribute('src', /445a78/);
    expect(errors).toEqual([]);
    process.stdout.write('Hero preview ratio, desktop copy, asset save, and reload echo passed.\n');
} finally {
    await browser.close();
}
