import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../artifacts/order-expenses/closure-20261004',
);
const origin = process.env.ORDER_EXPENSE_TEST_ORIGIN || 'http://127.0.0.1:5192';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const open = suffix => page.goto(`${origin}/e2e/order-expenses/index.html?${suffix}`);
try {
    await open('type=DIGITAL&legacy');
    await expect(page.getByText('数字商品 · 物流成本不适用', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^承运商实际物流成本/)).toHaveCount(0);
    await expect(page.getByText(/历史物流费用 MYR 5 保留审计/)).toBeVisible();
    await page.getByLabel(/^支付手续费/).fill('0');
    await page.getByLabel(/^拒付损失/).fill('0');
    await page.getByRole('button', { name: '保存经营费用' }).click();
    await expect(page.getByText('经营费用已保存，利润报表将重新核算')).toBeVisible();
    const digitalWrite = await page.evaluate(() => window.expenseFixture.writes);
    expect(digitalWrite).toHaveLength(1);
    expect(digitalWrite[0].input).not.toHaveProperty('carrierShippingCostMicrounits');
    expect(digitalWrite[0].input.paymentFeeMicrounits).toBe(0);
    await page.screenshot({ path: path.join(output, 'digital-desktop.png'), fullPage: true });
    await open('type=MIXED');
    await page.getByLabel(/^实物部分承运商物流成本/).fill('12.345');
    await page.getByLabel(/^支付手续费/).fill('');
    await page.getByLabel(/^拒付损失/).fill('0');
    await page.getByRole('button', { name: '保存经营费用' }).click();
    await expect(page.getByText('经营费用已保存，利润报表将重新核算')).toBeVisible();
    const physicalWrite = await page.evaluate(() => window.expenseFixture.writes);
    expect(physicalWrite[0].input.carrierShippingCostMicrounits).toBe(12345);
    expect(physicalWrite[0].input.paymentFeeMicrounits).toBeNull();
    await open('type=DIGITAL&readback-failure');
    await page.getByLabel(/^支付手续费/).fill('0');
    await page.getByRole('button', { name: '保存经营费用' }).click();
    await expect(page.getByText('操作已完成，但最新数据读取失败。请刷新页面，勿重复提交。')).toBeVisible();
    expect(await page.evaluate(() => window.expenseFixture.writes.length)).toBe(1);
    await open('type=DIGITAL&import');
    const csv = '订单号,实际物流成本,支付手续费,拒付损失\nDIGITAL-1,0,0,0\n';
    await page
        .locator('input[type=file]')
        .setInputFiles({ name: 'bad-expenses.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText(/第 2 行 DIGITAL-1：纯数字订单不适用承运商物流成本/)).toBeVisible();
    await expect(page.getByRole('button', { name: '确认导入 1 行' })).toBeDisabled();
    await page.locator('input[type=file]').setInputFiles({
        name: 'good-expenses.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv.replace('DIGITAL-1,0,0,0', 'DIGITAL-1,,0,0')),
    });
    await expect(page.getByRole('cell', { name: '不适用', exact: true })).toBeVisible();
    const confirm = page.getByRole('checkbox');
    await expect(confirm).toBeEnabled();
    await confirm.check();
    await page.getByRole('button', { name: '确认导入 1 行' }).click();
    await expect(page.getByText(/导入完成：共 1 行，新建 1 条/)).toBeVisible();
    expect(await page.evaluate(() => window.expenseFixture.writes.length)).toBe(1);
    await page.screenshot({ path: path.join(output, 'digital-import.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await open('type=DIGITAL');
    await expect(page.getByLabel(/^支付手续费/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, 'digital-mobile.png'), fullPage: true });
    await open('type=PHYSICAL&readonly');
    await expect(page.getByLabel(/^承运商实际物流成本/)).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存经营费用' })).toHaveCount(0);
    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'result.json'),
        JSON.stringify(
            {
                passed: true,
                data: 'synthetic Apollo contract, formal components, no production connection',
                scenarios: [
                    'digital save omits logistics',
                    'legacy audit preserved',
                    'mixed logistics and unknown fee',
                    'write success/read failure',
                    'digital import rejects logistics then accepts omission',
                    'mobile overflow',
                    'read-only permission',
                ],
                errors,
            },
            null,
            2,
        ),
    );
    console.log('Order expense synthetic browser acceptance passed');
} catch (error) {
    await writeFile(
        path.join(output, 'failure.json'),
        JSON.stringify(
            { error: String(error), pageErrors: errors, text: await page.locator('body').innerText() },
            null,
            2,
        ),
    );
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    throw error;
} finally {
    await browser.close();
}
