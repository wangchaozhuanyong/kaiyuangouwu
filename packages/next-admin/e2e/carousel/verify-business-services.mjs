import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./results', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?services&services-disabled&persist');
    await expect(page.getByRole('heading', { name: '商业服务页文案' })).toBeVisible();
    const hero = page.locator('[data-business-services-preview] [data-services-hero-layout]');
    const image = page.getByRole('img', { name: '商业服务页首配图预览' });
    const layout = page.getByRole('combobox', { name: '页首图文布局' });
    const language = page.getByRole('combobox', { name: '编辑语言' });
    const save = page.getByRole('button', { name: '保存并发布' });
    await expect(hero).toHaveAttribute('data-services-hero-layout', 'stacked');
    await expect(layout).toHaveValue('stacked');
    const originalImage = await image.getAttribute('src');
    await layout.selectOption('image-overlay');
    await expect(hero).toHaveAttribute('data-services-hero-layout', 'image-overlay');
    await expect(image).toHaveAttribute('src', originalImage);
    await expect(image).toHaveCSS('object-fit', 'contain');
    await expect(hero).toHaveCSS('display', 'grid');

    const chineseTitle =
        '智能服务帮助店铺连接工具权益与商业能力，中文标题可随时编辑并实时显示在图文预览中'.slice(0, 40);
    const chineseBody = '后台文字保持可编辑，布局由所有店铺共用，切换语言和布局都不会替换已有图片。'
        .repeat(6)
        .slice(0, 200);
    const englishTitle =
        'Explore shared business tools, services, and benefits with editable store content!'.slice(0, 80);
    const englishBody =
        'Store-managed text remains editable and readable. Shared layouts preserve image bindings and update both language previews immediately. '
            .repeat(2)
            .slice(0, 200);
    await page.getByRole('textbox', { name: /标题.*\/40/ }).fill(chineseTitle);
    await page.getByRole('textbox', { name: /说明.*\/200/ }).fill(chineseBody);
    await expect(hero.getByRole('heading', { name: chineseTitle, exact: true })).toBeVisible();
    await expect(hero.locator('p')).toHaveText(chineseBody);
    await language.selectOption('en');
    await page.getByRole('textbox', { name: /标题.*\/80/ }).fill(englishTitle);
    await page.getByRole('textbox', { name: /说明.*\/200/ }).fill(englishBody);
    await expect(hero.getByRole('heading', { name: englishTitle, exact: true })).toBeVisible();
    await expect(hero.locator('p')).toHaveText(englishBody);
    await expect(page.getByRole('combobox', { name: '预览语言' })).toHaveValue('en');
    await language.selectOption('zh_Hans');
    await expect(hero.getByRole('heading', { name: chineseTitle, exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '跳转链接地址（可选）' }).fill('https://example.com/services');
    await expect(hero.getByText('打开服务网站', { exact: true })).toBeVisible();
    await save.click();
    await expect(page.getByRole('status')).toContainText('已保存到当前店铺');
    const layoutWrite = await page.evaluate(() =>
        window.carouselFixture.operations
            .filter(operation => operation.name === 'NextAdminUpdateStorefrontBlock')
            .at(-1),
    );
    expect(layoutWrite.variables.input).toMatchObject({
        enabled: true,
        settings: { businessServicesHeroLayout: 'image-overlay' },
        targetType: 'URL',
        targetValue: 'https://example.com/services',
    });
    expect(layoutWrite.variables.input).not.toHaveProperty('imageAssetId');
    expect(layoutWrite.variables.input).not.toHaveProperty('imageUrl');
    expect(layoutWrite.variables.input.allowImageReplacement).not.toBe(true);
    await page.reload();
    await expect(layout).toHaveValue('image-overlay');
    await expect(image).toHaveAttribute('src', originalImage);
    await expect(hero.getByRole('heading', { name: chineseTitle, exact: true })).toBeVisible();
    await language.selectOption('en');
    await expect(hero.getByRole('heading', { name: englishTitle, exact: true })).toBeVisible();
    await expect(hero.locator('p')).toHaveText(englishBody);
    await hero.screenshot({ path: path.join(output, 'business-services-overlay-english-preview.png') });

    await page.getByRole('button', { name: '从素材库选择' }).click();
    await page
        .getByRole('dialog', { name: '选择图片素材' })
        .getByRole('button', { name: /替换轮播横幅/ })
        .click();
    await expect(image).toHaveAttribute('src', /445a78/);
    await expect(save).toBeDisabled();
    await page.getByRole('checkbox', { name: '我确认将当前已设置的商业服务页配图替换或清除' }).check();
    await save.click();
    await expect(page.getByRole('status')).toContainText('已保存到当前店铺');
    const imageWrite = await page.evaluate(() =>
        window.carouselFixture.operations
            .filter(operation => operation.name === 'NextAdminUpdateStorefrontBlock')
            .at(-1),
    );
    expect(imageWrite.variables.input).toMatchObject({
        imageAssetId: 'replacement-asset',
        imageUrl: null,
        allowImageReplacement: true,
        settings: { businessServicesHeroLayout: 'image-overlay' },
    });
    await page.reload();
    await expect(layout).toHaveValue('image-overlay');
    await expect(image).toHaveAttribute('src', /445a78/);
    await expect(page.getByRole('textbox', { name: '跳转链接地址（可选）' })).toHaveValue(
        'https://example.com/services',
    );
    await layout.selectOption('stacked');
    await expect(hero).toHaveAttribute('data-services-hero-layout', 'stacked');
    await expect(image).toHaveAttribute('src', /445a78/);
    await save.click();
    await expect(page.getByRole('status')).toContainText('已保存到当前店铺');
    await page.reload();
    await expect(layout).toHaveValue('stacked');
    await expect(image).toHaveAttribute('src', /445a78/);
    expect(errors).toEqual([]);
    process.stdout.write(
        'Business services shared layouts, bilingual drafts, image preservation/confirmation, and reload echo passed.\n',
    );
} finally {
    await browser.close();
}
