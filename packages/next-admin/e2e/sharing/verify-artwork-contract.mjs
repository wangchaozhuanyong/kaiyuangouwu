import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.SHARING_TEST_URL ?? 'http://127.0.0.1:5296/e2e/sharing/index.html';
const output = process.env.POSTER_ADMIN_TEST_OUTPUT ?? path.resolve('e2e/sharing/results/artwork-contract');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const editor = () => page.getByRole('dialog', { name: /分享海报模板/ });
const save = () => editor().getByRole('button', { name: '保存海报模板', exact: true });
const writes = () =>
    page.evaluate(
        () =>
            window.sharingFixture.operations.filter(item => item.name === 'AdminCreateReferralPoster').length,
    );
try {
    await page.goto(`${base}?readonly`);
    await expect(page.getByRole('heading', { name: '本店分享模板', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.sharingFixture.operations[0].variables.includeStoreProfile)).toBe(
        false,
    );
    await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeDisabled();
    for (const control of await page.getByRole('article').getByRole('button').all())
        await expect(control).toBeDisabled();
    for (const control of await page.getByRole('checkbox').all()) await expect(control).toBeDisabled();
    checks.push(
        'ReadReferral-only accounts omit myStoreProfile and can read sharing settings while all mutations remain disabled',
    );

    await page.goto(`${base}?read-error`);
    await expect(page.getByText('模拟分享读取失败')).toBeVisible();
    await page.evaluate(() => {
        window.sharingFixture.faults.read = false;
    });
    await page.getByRole('button', { name: /重试/ }).click();
    await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeEnabled();
    expect(
        await page.evaluate(
            () =>
                window.sharingFixture.operations.filter(item => item.name === 'AdminSharingSettings').at(-1)
                    .variables.includeStoreProfile,
        ),
    ).toBe(true);
    checks.push('First-read failure offers retry; authorized store profile is requested after recovery');

    await page.getByRole('button', { name: '新建模板', exact: true }).click();
    await editor().getByLabel('模板名称 *', { exact: true }).fill('读取失败仍保留成功写入');
    await editor().getByLabel('中文分享文案 *', { exact: true }).fill('看见更多生活灵感');
    await editor().getByRole('combobox', { name: '完整设计图 *', exact: true }).selectOption('asset-1');
    await expect(save()).toBeEnabled({ timeout: 20000 });
    await page.evaluate(() => {
        window.sharingFixture.faults.write = true;
    });
    await save().click();
    await expect(editor().getByRole('alert')).toContainText('模拟分享保存失败');
    await expect(editor().getByLabel('中文分享文案 *', { exact: true })).toHaveValue('看见更多生活灵感');
    await expect(editor().getByRole('combobox', { name: '完整设计图 *', exact: true })).toHaveValue(
        'asset-1',
    );
    expect(await writes()).toBe(1);
    await page.evaluate(() => {
        window.sharingFixture.faults.write = false;
        window.sharingFixture.faults.read = true;
    });
    await save().click();
    await expect(editor()).toHaveCount(0);
    await expect(page.getByText(/设置已保存，刷新失败/)).toBeVisible();
    expect(await writes()).toBe(2);
    expect(
        await page.evaluate(
            () =>
                window.sharingFixture
                    .state()
                    .posterTemplateConfigs.filter(item => item.name === '读取失败仍保留成功写入').length,
        ),
    ).toBe(1);
    await page.evaluate(() => {
        window.sharingFixture.faults.read = false;
    });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByRole('heading', { name: '读取失败仍保留成功写入', exact: true })).toBeVisible();
    expect(await writes()).toBe(2);
    checks.push(
        'Write failure retains artwork and copy; successful retry followed by read failure records one template; refresh retries only the read',
    );

    await page.goto(`${base}?empty`);
    await expect(page.getByText(/暂无店铺自定义海报模板/)).toBeVisible();
    await page.getByText('选择系统模板 · 5 款', { exact: true }).click();
    const legacy = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: '清透蓝白', exact: true }) });
    await legacy.getByRole('button', { name: '基于此款创建本店模板' }).click();
    await expect(editor().getByRole('combobox', { name: '设计模式', exact: true })).toHaveValue('LEGACY');
    await expect(editor().getByRole('img', { name: '当前文案的完整海报排版' })).toBeVisible({
        timeout: 20000,
    });
    await expect(save()).toBeEnabled({ timeout: 20000 });
    await save().click();
    await expect(page.getByRole('heading', { name: '清透蓝白 · 本店', exact: true })).toBeVisible();
    const copied = await page.evaluate(() => window.sharingFixture.state().posterTemplateConfigs[0]);
    expect(copied.layoutVariant).toBe('STANDARD_CENTER');
    expect(copied.enabled).toBe(false);
    checks.push(
        'Empty-state template creation preserves the legacy layout and stores copied system templates disabled',
    );

    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'browser-results.json'),
        JSON.stringify({ status: 'PASS', checks, pageErrors: errors }, null, 2),
    );
    console.log(`PASS: ${checks.length} artwork permission and recovery scenario groups`);
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
