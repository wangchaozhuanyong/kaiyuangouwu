import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const result = { scope: 'synthetic Admin fixture', states: [] };
try {
    await page.goto(process.env.SEO_ADMIN_TEST_URL ?? 'http://127.0.0.1:5342/e2e/seo-workspace/index.html');
    await expect(page.getByRole('heading', { name: '搜索收录设置' })).toBeVisible();
    await page.getByRole('button', { name: '查看“搜索与 AI 爬虫”功能说明', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '搜索与 AI 爬虫', exact: true })).toContainText(
        '控制本店的搜索收录配置与爬虫规则。',
    );
    await page.getByRole('button', { name: '关闭功能说明', exact: true }).click();
    result.states.push('real-feature-help-open-close');
    await expect(page.getByRole('checkbox', { name: '允许搜索收录' })).not.toBeChecked();
    await page.getByRole('checkbox', { name: '允许搜索收录' }).check();
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('草稿已保存，公开页面继续使用已发布版本。')).toBeVisible();
    await page.getByRole('button', { name: '发布已保存版本' }).click();
    await expect(page.getByText('当前收录：已开启配置')).toBeVisible();
    result.states.push('draft-save-publish');
    await page.screenshot({ path: output + 'settings-desktop.png', fullPage: true });
    await page.getByRole('button', { name: '切换合成店铺' }).click();
    await expect(page.getByText('店铺：synthetic-b')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '允许搜索收录' })).not.toBeChecked();
    result.states.push('channel-isolation');
    await page.getByRole('checkbox', { name: '允许搜索收录' }).check();
    await page.getByRole('button', { name: '切换合成读取失败' }).click();
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('操作已完成，但最新数据读取失败。请刷新页面，勿重复提交。')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '允许搜索收录' })).toBeChecked();
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.seoFixture.writes)).toBe(3);
    result.states.push('write-receipt-survives-failed-read');
    await page.getByRole('button', { name: '切换合成读取失败' }).click();
    await page.getByRole('button', { name: '刷新本页' }).click();
    await page.getByRole('link', { name: '平台证据', exact: true }).click();
    await expect(page.getByRole('heading', { name: '搜索平台与效果' })).toBeVisible();
    await page
        .getByRole('textbox', { name: 'CSV 数据' })
        .fill(
            'source,property,dateFrom,dateTo,url,status,evidenceUrl,impressions\nGSC,sc-domain:example.invalid,2026-10-01,2026-10-02,,MEASURED,https://example.invalid/evidence,7',
        );
    await page.getByRole('button', { name: '校验并加入草稿' }).click();
    await expect(page.getByText('1 行已加入草稿，尚未保存。')).toBeVisible();
    result.states.push('csv-evidence-provenance');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: output + 'platform-mobile.png', fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: output + 'platform-mobile-dark.png', fullPage: true });
    result.states.push('mobile-theme-no-horizontal-overflow');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
    await expect(page.locator('[data-storefront-seo-workspace]')).not.toContainText('未保存修改');
    const workspaceReadsBefore = await page.evaluate(
        () => window.seoFixture.operations.filter(name => name === 'NextAdminStorefrontSeoWorkspace').length,
    );
    await page.getByRole('link', { name: '仅商品权限 SEO' }).click();
    await expect(page.getByRole('heading', { name: '商品搜索优化' })).toBeVisible();
    await page.getByRole('textbox', { name: '搜索标题' }).fill('原生权限商品独立 SEO');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('页面草稿已保存，公开页面继续使用已发布版本。')).toBeVisible();
    await page.getByRole('button', { name: '发布已保存版本' }).click();
    await expect(page.getByText('页面配置已发布；实际网站上线状态以公开响应为准。')).toBeVisible();
    expect(
        await page.evaluate(
            () =>
                window.seoFixture.operations.filter(name => name === 'NextAdminStorefrontSeoWorkspace')
                    .length,
        ),
    ).toBe(workspaceReadsBefore);
    result.states.push('native-product-only-permission-read-save-publish-no-settings-read');
    await page.getByRole('link', { name: 'GEO 内容', exact: true }).click();
    await page.getByRole('textbox', { name: '文章网址标识' }).fill('synthetic-buyer-guide');
    await page.getByRole('textbox', { name: '文章网址标识' }).press('Tab');
    await page.getByRole('textbox', { name: '搜索标题' }).fill('合成验收：购买前的问题');
    await page.getByRole('textbox', { name: '简明答案摘要' }).fill('合成内容用于核验编辑流程。');
    await page
        .getByRole('textbox', { name: '正文（Markdown）' })
        .fill('# 合成问题\n\n本文是本地测试数据，不描述真实商家事实。');
    await page.getByRole('textbox', { name: '作者', exact: true }).fill('合成作者');
    await page.getByRole('textbox', { name: '事实审核人' }).fill('合成审核人');
    await page.getByLabel('实际审核时间', { exact: true }).fill('2026-10-10T10:00');
    await page.getByRole('button', { name: '添加来源' }).click();
    await page.getByRole('textbox', { name: '来源标题' }).fill('合成证据');
    await page.getByRole('textbox', { name: '来源地址' }).fill('https://example.invalid/source');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('页面草稿已保存，公开页面继续使用已发布版本。')).toBeVisible();
    await page.getByRole('button', { name: '发布已保存版本' }).click();
    await expect(page.getByText('页面配置已发布；实际网站上线状态以公开响应为准。')).toBeVisible();
    await expect(page.getByText('/zh/guides/synthetic-buyer-guide', { exact: true })).toBeVisible();
    result.states.push('geo-article-evidence-review-save-publish');
    expect(errors).toEqual([]);
    result.status = 'PASS';
    await writeFile(output + 'result.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
} finally {
    await browser.close();
}
