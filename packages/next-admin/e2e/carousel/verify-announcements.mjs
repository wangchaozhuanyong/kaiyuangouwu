import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?announcements&persist');
    await expect(page.getByRole('heading', { name: /^首页公告/ }).first()).toBeVisible();
    await page.getByRole('button', { name: '新建公告' }).first().click();
    const editor = page.getByRole('dialog', { name: '新建首页公告' });
    await expect(editor.getByRole('radio', { name: '指定店铺' })).toBeChecked();
    await expect(editor.getByRole('checkbox', { name: '预览测试店铺' })).toBeChecked();
    await editor.getByRole('textbox', { name: '中文标题 *' }).fill('本地发货提示');
    await editor.getByRole('textbox', { name: '中文正文 *' }).fill('以结算页显示的时效为准。');
    await editor.getByRole('spinbutton', { name: '优先级' }).fill('20');
    await editor.getByRole('textbox', { name: '跳转网址' }).fill('https://example.com/shipping');
    await editor.getByRole('button', { name: '创建公告' }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText('本地发货提示', { exact: true })).toBeVisible();
    const writes = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminCreateSystemAnnouncement',
        ),
    );
    expect(writes.at(-1).variables.input).toMatchObject({
        enabled: true,
        priority: 20,
        titleZh: '本地发货提示',
        contentZh: '以结算页显示的时效为准。',
        linkUrl: 'https://example.com/shipping',
        targetMode: 'SINGLE',
        channelIds: ['fixture'],
    });

    await page.reload();
    await expect(page.getByText('本地发货提示', { exact: true })).toBeVisible();
    await expect(page.getByText('预览测试店铺', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '编辑' }).first().click();
    const updateEditor = page.getByRole('dialog', { name: '编辑首页公告' });
    await expect(updateEditor.getByRole('checkbox', { name: '预览测试店铺' })).toBeChecked();
    await updateEditor.getByRole('checkbox', { name: '第二测试店铺' }).check();
    await updateEditor.getByRole('button', { name: '保存公告' }).click();
    await expect(updateEditor).toHaveCount(0);
    const updates = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminUpdateSystemAnnouncement',
        ),
    );
    expect(updates.at(-1).variables.input).toMatchObject({
        targetMode: 'MULTIPLE',
        channelIds: ['fixture', 'other-fixture'],
    });

    await page.getByRole('button', { name: '新建公告' }).first().click();
    const allEditor = page.getByRole('dialog', { name: '新建首页公告' });
    await allEditor.getByRole('radio', { name: '全部店铺' }).check();
    await allEditor.getByRole('textbox', { name: '中文标题 *' }).fill('全店公告');
    await allEditor.getByRole('textbox', { name: '中文正文 *' }).fill('覆盖所有店铺。');
    await allEditor.getByRole('button', { name: '创建公告' }).click();
    await expect(allEditor).toHaveCount(0);
    const allWrites = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminCreateSystemAnnouncement',
        ),
    );
    expect(allWrites.at(-1).variables.input).toMatchObject({ targetMode: 'ALL', channelIds: [] });
    await expect(page.getByText('全部店铺', { exact: true }).first()).toBeVisible();

    await page.goto('http://127.0.0.1:5296/e2e/carousel/index.html?announcements&platform-channel');
    await page.getByRole('button', { name: '新建公告' }).first().click();
    const platformEditor = page.getByRole('dialog', { name: '新建首页公告' });
    await expect(platformEditor.getByText('当前是平台管理频道，请手动选择经营店铺。')).toBeVisible();
    await expect(platformEditor.getByText('请至少选择一个目标店铺')).toBeVisible();
    await expect(platformEditor.getByRole('checkbox', { name: '预览测试店铺' })).not.toBeChecked();
    await platformEditor.getByRole('checkbox', { name: '预览测试店铺' }).check();
    await platformEditor.getByRole('textbox', { name: '中文标题 *' }).fill('指定店铺公告');
    await platformEditor.getByRole('textbox', { name: '中文正文 *' }).fill('仅经营店铺可见。');
    await platformEditor.getByRole('button', { name: '创建公告' }).click();
    await expect(platformEditor).toHaveCount(0);
    const platformWrites = await page.evaluate(() =>
        window.carouselFixture.operations.filter(
            operation => operation.name === 'NextAdminCreateSystemAnnouncement',
        ),
    );
    expect(platformWrites.at(-1).variables.input).toMatchObject({
        targetMode: 'SINGLE',
        channelIds: ['fixture'],
    });
    expect(errors).toEqual([]);
    process.stdout.write(
        'Announcement scope defaults, targeted update, explicit global scope, platform guard, and reload passed.\n',
    );
} finally {
    await browser.close();
}
