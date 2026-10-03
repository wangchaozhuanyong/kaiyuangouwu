import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/platform-governance/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const failures = [];
page.on('pageerror', error => failures.push(error.message));
await page.route('**/admin-order-events*', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': synthetic local fixture\n\n' }),
);
const url = 'http://127.0.0.1:57349/e2e/platform-governance/index.html';
try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '平台商品分配中心', exact: true })).toBeVisible({
        timeout: 20000,
    });
    await expect(page).toHaveTitle(/模钥平台管理中心/);
    await page.getByRole('checkbox', { name: '选择 示例订阅' }).check();
    await page.getByText('销售店 · USD', { exact: true }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '生成预览', exact: true }).click();
    await page.getByRole('button', { name: '确认执行此预览' }).click();
    await expect(page.getByText('已回读：启用')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'platform-result.png'), fullPage: true });
    await page
        .locator('section')
        .first()
        .evaluate(element => (element.parentElement.scrollTop = 0));
    await page.screenshot({ path: path.join(output, 'platform-desktop.png'), fullPage: true });
    await page.getByLabel('切换当前店铺').selectOption('synthetic-seller');
    await expect(page).toHaveTitle(/销售店 · 管理后台/);
    await expect(page.getByRole('heading', { name: '商品管理', exact: false })).toBeVisible();
    await expect(page.getByLabel('本店经营统计')).toContainText('本店上架率：100%');
    await expect(page.getByRole('link', { name: '平台商品分配中心' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '本店经营设置' })).toBeVisible();
    await page.screenshot({ path: path.join(output, 'seller-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: '商品管理', exact: false })).toBeVisible();
    await page.screenshot({ path: path.join(output, 'seller-mobile.png'), fullPage: true });
    await page.goto(url + '?store=synthetic-seller&displayLanguageCode=en');
    await expect(page).toHaveTitle(/Seller Store · Admin/);
    await page.goto(url + '?store=synthetic-platform&page=payment');
    await expect(page.getByText('平台统一配置支付系统；经营店铺独立选择开启或关闭')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.screenshot({ path: path.join(output, 'payment-platform.png'), fullPage: true });
    await page.goto(url + '?store=synthetic-seller&page=payment');
    await expect(page.getByRole('heading', { name: '本店支付方式', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
    await expect(page.getByText('USDT 收款配置 · 展开查看状态、汇率与收款地址')).toHaveCount(0);
    const paymentSwitch = page.getByRole('checkbox', { name: '本店统一测试支付开关' });
    await paymentSwitch.check();
    await expect(page.getByText('本店已开启', { exact: true })).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() =>
                window.governanceFixtureOperations.includes('NextAdminSetMyStorePaymentOptionEnabled'),
            ),
        )
        .toBe(true);
    await page.screenshot({ path: path.join(output, 'payment-store.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'payment-store-mobile.png'), fullPage: true });
    if (failures.length) throw new Error('Page exceptions: ' + failures.join('; '));
    await writeFile(
        path.join(output, 'acceptance.json'),
        JSON.stringify(
            {
                mode: 'SYNTHETIC_LOCAL_UI',
                checks: [
                    'platform_preview_execute_readback',
                    'store_switch_brand_and_title',
                    'operating_store_stats_only',
                    'platform_menu_hidden_in_store',
                    'mobile_layout',
                    'english_store_title',
                    'platform_payment_configuration_only',
                    'store_payment_switch_mutation_readback',
                    'store_has_no_payment_configuration_or_wallet_editor',
                ],
                browserErrors: failures,
                production: false,
            },
            null,
            2,
        ),
    );
    process.stdout.write('LOCAL_UI_ACCEPTANCE_PASS\n');
} finally {
    await browser.close();
}
