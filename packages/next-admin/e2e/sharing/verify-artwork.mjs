import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.SHARING_TEST_URL ?? 'http://127.0.0.1:5296/e2e/sharing/index.html';
const output = process.env.POSTER_ADMIN_TEST_OUTPUT ?? path.resolve('e2e/sharing/results/artwork');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const editor = () => page.getByRole('dialog', { name: /分享海报模板/ });
const save = () => editor().getByRole('button', { name: '保存海报模板', exact: true });
const card = name =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
try {
    await page.goto(base);
    await page.getByRole('button', { name: '新建模板', exact: true }).click();
    await expect(editor().getByLabel('设计模式')).toHaveValue('ARTWORK_QR');
    await expect(save()).toBeDisabled();
    await editor().getByLabel('模板名称 *', { exact: true }).fill('圆形整图候选');
    await editor().getByLabel('中文分享文案 *', { exact: true }).fill('发现店铺好物');
    await editor().getByRole('combobox', { name: '完整设计图 *', exact: true }).selectOption('asset-1');
    await expect(save()).toBeEnabled({ timeout: 20000 });
    await expect(editor().getByText(/当前店铺：分享测试店 A/)).toBeVisible();
    await expect(editor().getByText(/测试邀请码 PREVIEW/)).toBeVisible();
    const preview = editor().getByRole('img', { name: '当前文案的完整海报排版' });
    expect(await preview.evaluate(img => [img.naturalWidth, img.naturalHeight])).toEqual([1080, 1920]);
    for (const name of ['极简圆环', '星芒圆盘', '极光轨道', '香槟徽章', '翡翠涟漪']) {
        await editor().getByRole('button', { name, exact: true }).click();
        await expect(editor().getByRole('button', { name, exact: true })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        await expect(save()).toBeEnabled({ timeout: 20000 });
    }
    checks.push(
        'New artwork needs only share headline and image, shows current store brand, renders at actual dimensions and supports all five styles',
    );
    const cx = editor().getByLabel('圆心 X (px)', { exact: true });
    const cy = editor().getByLabel('圆心 Y (px)', { exact: true });
    await editor().getByRole('button', { name: '拖动二维码圆位', exact: true }).focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(cx).toHaveValue('550');
    const position = await editor()
        .getByRole('button', { name: '拖动二维码圆位', exact: true })
        .boundingBox();
    await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2);
    await page.mouse.down();
    await page.mouse.move(position.x + position.width / 2 - 10, position.y + position.height / 2 - 10);
    await page.mouse.up();
    expect(Number(await cx.inputValue())).toBeLessThan(550);
    expect(Number(await cy.inputValue())).toBeLessThan(1488);
    const diameter = editor().getByLabel('圆形直径 (px)', { exact: true });
    const handle = await editor()
        .getByRole('button', { name: '拖动调整二维码直径', exact: true })
        .boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 8, handle.y + handle.height / 2);
    await page.mouse.up();
    expect(Number(await diameter.inputValue())).toBeGreaterThan(456);
    await editor().getByRole('button', { name: '恢复默认规格' }).click();
    const downloadPromise = page.waitForEvent('download');
    await editor().getByRole('button', { name: '下载留位参考图' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('poster-guide-1080x1920.png');
    await download.saveAs(path.join(output, download.suggestedFilename()));
    checks.push('Circle pointer move, keyboard move, pointer resize and downloadable guide');
    await cx.fill('0');
    await expect(save()).toBeDisabled();
    await expect(editor().getByText('二维码圆形区域必须完整位于画布内').first()).toBeVisible();
    await cx.fill('540');
    await editor().getByRole('combobox', { name: '海报规格', exact: true }).selectOption('1:1');
    await expect(editor().getByLabel('画布高度 (px)')).toHaveValue('1080');
    await expect(save()).toBeDisabled();
    await editor().getByRole('combobox', { name: '完整设计图 *', exact: true }).selectOption('asset-square');
    await expect(save()).toBeEnabled({ timeout: 20000 });
    expect(await preview.evaluate(img => [img.naturalWidth, img.naturalHeight])).toEqual([1080, 1080]);
    await editor().getByRole('combobox', { name: '海报规格', exact: true }).selectOption('custom');
    await expect(editor().getByRole('combobox', { name: '海报规格', exact: true })).toHaveValue('custom');
    await editor().getByLabel('画布宽度 (px)').fill('1200');
    await expect(save()).toBeDisabled();
    await expect(
        editor()
            .getByText(/比例不一致/)
            .first(),
    ).toBeVisible();
    await editor().getByRole('button', { name: '恢复默认规格' }).click();
    await editor().getByRole('combobox', { name: '完整设计图 *', exact: true }).selectOption('asset-broken');
    await expect(save()).toBeDisabled();
    await expect(
        editor()
            .getByText(/图片加载失败|图片.*失败|无法加载/)
            .first(),
    ).toBeVisible({ timeout: 20000 });
    await editor().getByRole('combobox', { name: '完整设计图 *', exact: true }).selectOption('asset-1');
    await expect(save()).toBeEnabled({ timeout: 20000 });
    checks.push(
        'Invalid circle, image ratio and unreadable image block save; square and custom dimensions recover',
    );
    page.once('dialog', dialog => dialog.dismiss());
    await editor().getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor()).toBeVisible();
    await page.screenshot({ path: path.join(output, 'editor-desktop.png'), fullPage: true });
    await save().click();
    await expect(editor()).toHaveCount(0);
    await expect(card('圆形整图候选')).toBeVisible();
    const state = await page.evaluate(() => window.sharingFixture.state());
    const saved = state.posterTemplateConfigs.find(item => item.name === '圆形整图候选');
    expect(saved.enabled).toBe(false);
    expect(saved.design.canvas).toEqual({ width: 1080, height: 1920 });
    expect(saved.posterBackgroundAsset.id).toBe('asset-1');
    await card('圆形整图候选').getByRole('button', { name: '复制模板', exact: true }).click();
    await expect(editor().getByLabel('模板名称 *', { exact: true })).toHaveValue('圆形整图候选 · 本店');
    await expect(editor().getByRole('combobox', { name: '完整设计图 *', exact: true })).toHaveValue(
        'asset-1',
    );
    await expect(save()).toBeEnabled({ timeout: 20000 });
    await save().click();
    await expect(card('圆形整图候选 · 本店')).toBeVisible();
    checks.push(
        'Unsaved dialog close is guarded; save/readback retains layout, artwork and disabled state; copying reuses configuration',
    );
    await card('圆形整图候选').getByRole('button', { name: '编辑', exact: true }).click();
    await page.evaluate(() => window.sharingFixture.disableCustomConcurrently());
    await expect(editor().getByText(/当前草稿已保留/)).toBeVisible();
    await expect(save()).toBeDisabled();
    await editor().getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '新建模板', exact: true }).click();
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await editor().getByLabel('模板名称 *', { exact: true }).fill('手机草稿');
    await editor().getByRole('combobox', { name: '完整设计图 *', exact: true }).selectOption('asset-1');
    await page.screenshot({ path: path.join(output, 'editor-mobile.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(output, 'editor-mobile-dark.png'), fullPage: true });
    await page.evaluate(() => window.sharingFixture.switchChannel());
    await expect(editor()).toHaveCount(0);
    await expect(page.getByText(/当前店铺：分享测试店 B/)).toBeVisible();
    checks.push(
        'Concurrent version blocks saves, mobile widths remain contained, dark theme and store scope switch do not retain previous store editor',
    );
    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'browser-results.json'),
        JSON.stringify({ status: 'PASS', checks, pageErrors: errors }, null, 2),
    );
    console.log(`PASS: ${checks.length} artwork browser scenario groups`);
} catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    await writeFile(
        path.join(output, 'failure.txt'),
        `${error.stack}\n${await page.locator('body').innerText()}\n${JSON.stringify(errors)}`,
    );
    throw error;
} finally {
    await browser.close();
}
