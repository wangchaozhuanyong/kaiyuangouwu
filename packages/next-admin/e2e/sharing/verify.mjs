import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.SHARING_TEST_URL ?? 'http://127.0.0.1:5296/e2e/sharing/index.html';
const output = process.env.STOREFRONT_TEST_OUTPUT ?? path.resolve('e2e/sharing/results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => window.sharingFixture.state());
const card = name =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
const editor = () => page.getByRole('dialog', { name: /分享海报模板/ });
try {
    await page.goto(`${base}?legacy`);
    await expect(page.getByRole('heading', { name: /^分享设置/ })).toBeVisible();
    await expect(page.getByTestId('route')).toHaveText('/marketing/sharing');
    await expect(page.getByRole('article')).toHaveCount(6);
    expect(await page.evaluate(() => window.sharingFixture.operations.map(o => o.name))).toEqual([
        'AdminSharingSettings',
    ]);
    checks.push(
        'Legacy poster tab redirects to independent sharing query, with five existing presets and custom templates',
    );
    await page.screenshot({ path: `${output}/sharing-desktop.png`, fullPage: true });
    const before = await state();
    await card('暖砂纸艺').getByRole('button', { name: '设为默认海报', exact: true }).click();
    await expect.poll(async () => (await state()).defaultPosterTemplate).toBe('BENEFIT_RED_GOLD');
    await expect(card('暖砂纸艺').getByRole('button', { name: '当前为默认海报' })).toBeVisible();
    await card('暖砂纸艺').getByRole('checkbox').click();
    await expect.poll(async () => (await state()).posterTemplates.includes('BENEFIT_RED_GOLD')).toBe(false);
    await expect.poll(async () => (await state()).defaultPosterTemplate).toBe('BRAND_MINIMAL');
    const after = await state();
    for (const key of [
        'enabled',
        'rewardRate',
        'releaseDelayDays',
        'minimumOrderAmount',
        'maxRewardPerOrder',
        'allowBalanceSpend',
        'attributionWindowDays',
    ])
        expect(after[key]).toEqual(before[key]);
    const inputs = await page.evaluate(() =>
        window.sharingFixture.operations
            .filter(o => o.name === 'AdminUpdateReferralProgram')
            .map(o => o.variables.input),
    );
    expect(inputs[0].expectedUpdatedAt).toBe(before.updatedAt);
    expect(inputs[1].expectedUpdatedAt).not.toBe(inputs[0].expectedUpdatedAt);
    checks.push(
        'Default and visibility persist, reconcile disabled default, preserve financial fields, and send current revision',
    );
    await expect(card('本店分享模板').getByRole('checkbox')).toBeEnabled();
    await card('本店分享模板').getByRole('checkbox').click();
    await expect.poll(async () => (await state()).posterTemplateConfigs[0].enabled).toBe(false);
    await expect(card('本店分享模板').getByRole('button', { name: '编辑', exact: true })).toBeEnabled();
    await card('本店分享模板').getByRole('button', { name: '编辑', exact: true }).click();
    await expect(editor().getByRole('img', { name: '当前文案的完整海报排版' })).toBeVisible({
        timeout: 20000,
    });
    await editor().getByLabel('模板名称 *', { exact: true }).fill('更新后的分享模板');
    await editor().getByRole('combobox', { name: '海报背景图', exact: true }).selectOption('asset-1');
    await editor().getByRole('textbox').filter({ hasText: '精选商品与服务' }).first().fill('本店好物');
    await editor().getByRole('combobox', { name: '海报预览语言' }).selectOption('en');
    await expect(editor().getByRole('button', { name: '保存海报模板' })).toBeEnabled({ timeout: 20000 });
    await page.evaluate(() => {
        window.sharingFixture.faults.write = true;
    });
    await editor().getByRole('button', { name: '保存海报模板' }).click();
    await expect(editor().getByRole('alert')).toContainText('模拟分享保存失败');
    await expect(editor().getByLabel('模板名称 *', { exact: true })).toHaveValue('更新后的分享模板');
    await page.evaluate(() => {
        window.sharingFixture.faults.write = false;
    });
    await editor().getByRole('button', { name: '保存海报模板' }).click();
    await expect(editor()).toHaveCount(0);
    await expect(card('更新后的分享模板')).toBeVisible();
    expect((await state()).posterTemplateConfigs[0].posterBackgroundAsset.id).toBe('asset-1');
    expect((await state()).posterTemplateConfigs[0].titleZh).toBe('本店好物');
    checks.push(
        'Custom visibility, background and copy editing, bilingual canvas preview, save failure draft retention and successful save',
    );

    await card('清透蓝白').getByRole('button', { name: '基于此款创建本店模板' }).click();
    await expect(editor().getByLabel('模板名称 *', { exact: true })).toHaveValue('清透蓝白 · 本店');
    await expect(editor().getByRole('button', { name: '保存海报模板' })).toBeEnabled({ timeout: 20000 });
    await editor().getByRole('button', { name: '保存海报模板' }).click();
    await expect(card('清透蓝白 · 本店')).toBeVisible();
    checks.push('System presets create editable store templates without altering source presets');
    await page.evaluate(() => {
        window.sharingFixture.faults.read = true;
    });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '分享设置刷新失败' })).toBeVisible();
    await expect(card('清透蓝白').getByRole('checkbox')).toBeDisabled();
    await page.evaluate(() => {
        window.sharingFixture.faults.read = false;
    });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(card('清透蓝白').getByRole('checkbox')).toBeEnabled();
    checks.push('Refetch failure blocks edits to stale data until a successful refresh');
    await card('更新后的分享模板').getByRole('button', { name: '编辑', exact: true }).click();
    await page.evaluate(() => window.sharingFixture.switchChannel());
    await expect(editor()).toHaveCount(0);
    await expect(page.getByText(/分享测试店 B/)).toBeVisible();
    await expect(card('本店分享模板')).toBeVisible();
    checks.push('Changing stores clears open editor and loads the selected store settings');
    await page.goto(`${base}?readonly`);
    await expect(card('清透蓝白')).toBeVisible();
    for (const control of await page.getByRole('article').getByRole('button').all())
        await expect(control).toBeDisabled();
    for (const control of await page.getByRole('checkbox').all()) await expect(control).toBeDisabled();
    await expect(page.getByRole('button', { name: '新建模板' })).toBeDisabled();
    checks.push('Read-only accounts cannot create, edit, toggle, set default or delete');
    await page.goto(`${base}?read-error`);
    await expect(page.getByText('模拟分享读取失败')).toBeVisible();
    await page.evaluate(() => {
        window.sharingFixture.faults.read = false;
    });
    await page.getByRole('button', { name: /重试/ }).click();
    await expect(card('清透蓝白')).toBeVisible();
    checks.push('Initial read failure and retry');
    await page.goto(`${base}?empty`);
    await expect(page.getByText(/暂无店铺自定义海报模板/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
    await page.screenshot({ path: `${output}/sharing-mobile.png`, fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: `${output}/sharing-mobile-dark.png`, fullPage: true });
    checks.push('Empty custom list, 390px mobile layout and dark appearance');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(new URL('/e2e/carousel/index.html?sharing-records', base).href);
    await expect(
        page.getByRole('region', { name: '首页楼层', exact: true }).getByRole('article'),
    ).toHaveCount(3);
    await expect(page.getByText('分享海报 · 清透蓝白')).toHaveCount(0);
    expect(
        await page.evaluate(() =>
            window.carouselFixture.state().blocks.some(b => b.id === 'sharing-poster' && b.enabled),
        ),
    ).toBe(true);
    await page.screenshot({ path: `${output}/decoration-excludes-sharing.png`, fullPage: true });
    checks.push('Enabled sharing content remains in storage and is absent from decoration list and preview');
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/browser-results.json`,
        JSON.stringify({ status: 'PASS', checks, pageErrors: errors }, null, 2),
    );
    console.log(`PASS: ${checks.length} browser checks`);
} catch (error) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    await writeFile(
        `${output}/failure.txt`,
        `${error.stack}\nPage errors: ${JSON.stringify(errors)}\n${await page.locator('body').innerText()}`,
    );
    throw error;
} finally {
    await browser.close();
}
