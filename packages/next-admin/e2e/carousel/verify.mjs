import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.CAROUSEL_TEST_URL ?? 'http://127.0.0.1:5296/e2e/carousel/index.html';
const output = process.env.STOREFRONT_TEST_OUTPUT ?? path.resolve('e2e/carousel/results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => window.carouselFixture.state());
const manager = () => page.getByRole('dialog', { name: '首页轮播图', exact: true });
const floors = () => page.getByRole('region', { name: '首页楼层', exact: true });
const editor = () => page.getByRole('dialog', { name: /店铺楼层区块/ });
try {
    await page.goto(base);
    await expect(floors().getByRole('article')).toHaveCount(3);
    await expect(floors().getByRole('article', { name: '首页轮播', exact: true })).toContainText(
        '3 张轮播图',
    );
    await expect(page.getByRole('spinbutton', { name: '轮播间隔（秒）' })).toHaveCount(0);
    const preview = page.getByRole('region', { name: '首页轮播预览' });
    await expect(preview.getByRole('img')).toHaveCount(1);
    await preview.getByRole('button', { name: '预览第 2 张轮播图' }).click();
    await expect(preview.getByRole('heading', { name: '留学服务' })).toBeVisible();
    await page.screenshot({ path: `${output}/homepage-desktop.png`, fullPage: true });

    await page.getByRole('button', { name: '首页轮播图', exact: true }).click();
    await expect(manager().getByRole('article')).toHaveCount(3);
    await manager().getByRole('spinbutton', { name: '轮播间隔（秒）' }).fill('8');
    await manager().getByRole('button', { name: '保存间隔' }).click();
    await expect(manager().getByRole('status')).toContainText('8 秒');
    await expect.poll(async () => (await state()).interval).toBe(8);
    await manager().getByRole('spinbutton').fill('2');
    await manager().getByRole('button', { name: '保存间隔' }).click();
    expect((await state()).interval).toBe(8);
    expect(
        await manager()
            .getByRole('spinbutton')
            .evaluate(el => el.validity.valid),
    ).toBe(false);
    await manager().getByRole('spinbutton').fill('8');

    await manager()
        .getByRole('article', { name: '生活好物', exact: true })
        .getByRole('button', { name: '下移', exact: true })
        .click();
    await expect(manager().getByRole('article').first()).toHaveAccessibleName('留学服务');
    await expect(manager().getByRole('button', { name: '关闭轮播图管理' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(manager()).toHaveCount(0);
    await expect(page.getByRole('button', { name: '首页轮播图', exact: true })).toBeFocused();
    await floors().getByRole('button', { name: '下移首页轮播' }).click();
    await expect
        .poll(() =>
            floors()
                .getByRole('article')
                .evaluateAll(items => items.map(item => item.getAttribute('aria-label'))),
        )
        .toEqual(['服务公告', '热门商品', '首页轮播']);
    expect((await state()).blocks.map(block => block.id)).toEqual([
        'notice',
        'products',
        'hero-b',
        'hero-a',
        'hero-c',
        'legal',
    ]);

    await floors().getByRole('button', { name: '管理轮播图' }).click();
    await manager()
        .getByRole('article', { name: '留学服务', exact: true })
        .getByRole('button', { name: '编辑', exact: true })
        .click();
    await editor().getByLabel('中文标题 *', { exact: true }).fill('留学与签证');
    await editor()
        .getByRole('combobox', { name: /^跳转类型/ })
        .selectOption('URL');
    await editor().getByLabel('跳转目标', { exact: true }).fill('https://example.com/study');
    await editor().getByRole('button', { name: '保存并生效' }).click();
    await expect(editor()).toHaveCount(0);
    await expect(manager().getByRole('article', { name: '留学与签证', exact: true })).toBeVisible();
    expect((await state()).blocks.find(block => block.id === 'hero-b').targetValue).toBe(
        'https://example.com/study',
    );

    await manager()
        .getByRole('article', { name: 'AI 订阅', exact: true })
        .getByRole('button', { name: '启用', exact: true })
        .click();
    await expect(manager().getByRole('article', { name: 'AI 订阅', exact: true })).toContainText('展示中');
    await page.evaluate(() => {
        window.carouselFixture.faults.delete = true;
    });
    await manager()
        .getByRole('article', { name: 'AI 订阅', exact: true })
        .getByRole('button', { name: '删除', exact: true })
        .click();
    const confirmation = page.getByRole('alertdialog', { name: '删除轮播图' });
    await confirmation.getByRole('button', { name: '确认删除' }).click();
    await expect(confirmation.getByRole('alert')).toContainText('模拟删除被拒绝');
    expect((await state()).blocks.some(block => block.id === 'hero-c')).toBe(true);
    await page.evaluate(() => {
        window.carouselFixture.faults.delete = false;
    });
    await confirmation.getByRole('button', { name: '确认删除' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(manager().getByRole('article')).toHaveCount(2);

    await manager().getByRole('button', { name: '新增轮播图' }).click();
    await editor().getByLabel('中文标题 *', { exact: true }).fill('新增轮播测试');
    await editor().getByRole('checkbox', { name: '前台启用' }).check();
    await expect(editor().getByRole('button', { name: '保存并生效' })).toBeDisabled();
    await editor().getByRole('button', { name: '从素材库选择' }).first().click();
    const picker = page.getByRole('dialog', { name: '选择图片素材' });
    await picker.getByRole('button', { name: /轮播测试素材/ }).click();
    await expect(picker).toHaveCount(0);
    await editor().getByRole('button', { name: '保存并生效' }).click();
    await expect(editor()).toHaveCount(0);
    await expect(manager().getByRole('article')).toHaveCount(3);
    await expect(manager().getByRole('button', { name: '关闭轮播图管理' })).toBeEnabled();
    const afterCreate = (await state()).blocks;
    expect(afterCreate.filter(block => block.type !== 'LEGAL').map(block => block.type)).toEqual([
        'NOTICE',
        'BEST_SELLERS',
        'HERO',
        'HERO',
        'HERO',
    ]);
    expect(afterCreate[4].id).toBe('legal');
    expect(afterCreate.filter(block => block.type === 'HERO').at(-1).translations[0].title).toBe(
        '新增轮播测试',
    );

    await manager()
        .getByRole('article', { name: '新增轮播测试', exact: true })
        .getByRole('button', { name: '编辑', exact: true })
        .click();
    await editor().getByLabel('中文标题 *', { exact: true }).fill('保存失败保留草稿');
    await page.evaluate(() => {
        window.carouselFixture.faults.write = true;
    });
    await editor().getByRole('button', { name: '保存并生效' }).click();
    await expect(editor().getByRole('alert')).toContainText('模拟保存失败');
    await expect(editor().getByLabel('中文标题 *', { exact: true })).toHaveValue('保存失败保留草稿');
    await editor().getByRole('button', { name: '关闭编辑器' }).click();
    await page.evaluate(() => {
        window.carouselFixture.faults.write = false;
    });
    await page.screenshot({ path: `${output}/carousel-manager-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(manager().getByRole('button', { name: '新增轮播图' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await manager().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `${output}/carousel-manager-mobile.png`, fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: `${output}/carousel-manager-mobile-dark.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${output}/carousel-manager-desktop-dark.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    await manager().getByRole('button', { name: '关闭轮播图管理' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/homepage-mobile.png`, fullPage: true });

    await page.goto(`${base}?empty`);
    await page.getByRole('button', { name: '首页轮播图', exact: true }).click();
    await expect(manager().getByRole('heading', { name: '还没有轮播图' })).toBeVisible();
    await expect(manager().getByRole('button', { name: '新增轮播图' })).toBeEnabled();
    await page.goto(`${base}?read-error`);
    await page.getByRole('button', { name: '首页轮播图', exact: true }).click();
    await expect(manager().getByRole('heading', { name: '楼层加载失败' })).toBeVisible();
    await page.evaluate(() => {
        window.carouselFixture.faults.read = false;
    });
    await manager().getByRole('button', { name: '重试', exact: true }).click();
    await expect(manager().getByRole('article')).toHaveCount(3);
    await page.goto(`${base}?readonly`);
    await page.getByRole('button', { name: '首页轮播图', exact: true }).click();
    await expect(manager().getByRole('article')).toHaveCount(3);
    await expect(manager().getByRole('spinbutton', { name: '轮播间隔（秒）' })).toBeDisabled();
    await expect(manager().getByRole('button', { name: '新增轮播图' })).toBeDisabled();
    await expect(manager().getByRole('button', { name: '编辑', exact: true }).first()).toBeDisabled();
    await expect(manager().getByRole('button', { name: '删除', exact: true }).first()).toBeDisabled();
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/browser-result.json`,
        JSON.stringify(
            {
                status: 'PASS',
                source: 'isolated in-memory GraphQL fixture',
                checks: [
                    'grouped floor and preview',
                    'interval save and validation',
                    'slide and floor order persistence',
                    'edit copy and link',
                    'enable slide',
                    'delete refusal and retry',
                    'create with asset and keep group position',
                    'save failure retains draft',
                    'keyboard close and focus return',
                    '390px mobile layout',
                    'empty and read failure recovery',
                    'read-only content role cannot create, edit, delete or change interval',
                ],
                errors,
            },
            null,
            2,
        ),
    );
    console.log('Carousel browser checks passed (isolated fixture)');
} catch (error) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    console.error(errors);
    throw error;
} finally {
    await browser.close();
}
