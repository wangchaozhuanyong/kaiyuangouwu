import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../test-results/functional-repairs-20261026/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
try {
    for (const width of [390, 1440]) {
        const context = await browser.newContext({ viewport: { width, height: 960 } });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route =>
            new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
        );
        const base = 'http://127.0.0.1:5188/e2e/checkout-state-repair/';
        await page.goto(`${base}?view=flow`);
        await expect(page.locator('.digital-delivery-email-trigger')).toContainText('default@example.test');
        await page.getByRole('button', { name: /提交订单/ }).click();
        await expect(page.getByText('Synthetic card', { exact: true })).toBeVisible();
        for (const currency of ['USDT', 'CNY']) {
            await page.getByRole('button', { name: '返回修改订单', exact: true }).click();
            await expect(page.locator('.digital-delivery-email-trigger')).toBeVisible();
            await page.getByRole('button', { name: 'Toggle currency', exact: true }).click();
            await page.getByRole('button', { name: /提交订单/ }).click();
            if (currency === 'CNY')
                await expect(page.getByText('Synthetic card', { exact: true })).toBeVisible();
            else await expect(page.getByText('Synthetic card', { exact: true })).toHaveCount(0);
            await expect
                .poll(async () => JSON.parse(await page.getByTestId('counters').textContent()).methodReads)
                .toBe(currency === 'USDT' ? 2 : 3);
            checks.push(
                `${width}: real checkout/payment components return-edit → ${currency} → prepare/prefetch`,
            );
        }
        for (let store = 1; store <= 3; store++) {
            if (store === 3)
                await page.getByRole('button', { name: 'Refresh original store', exact: true }).click();
            await page.getByRole('button', { name: 'Switch store', exact: true }).click();
            await expect(page.getByText('Synthetic card', { exact: true })).toBeVisible();
            await expect
                .poll(async () => JSON.parse(await page.getByTestId('counters').textContent()).methodReads)
                .toBe(3 + store);
        }
        checks.push(`${width}: three synthetic store scopes keep separate method reads`);
        await page.screenshot({ path: `${output}/flow-${width}.png`, fullPage: true });
        await page.goto(`${base}?view=gpt`);
        await page.locator('#gpt-code').fill('SYNTHETIC-ONLY');
        await page.reload();
        await expect(page.locator('#gpt-code')).toHaveValue('');
        await page.goto(`${base}?view=support`);
        await page.goBack();
        await expect(page.locator('#gpt-code')).toBeVisible();
        await page.goForward();
        await expect(page.locator('.support-evaluation-submit-btn')).toBeVisible();
        checks.push(`${width}: direct deep link, hard refresh, browser back/forward`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow).toBe(false);
        await context.close();
    }
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/browser-journey.json`,
        JSON.stringify(
            {
                checks,
                errors,
                data: 'Synthetic peripheral APIs; real checkout/payment/route components. No actual AppState reopening or payment sandbox.',
            },
            null,
            2,
        ),
    );
    process.stdout.write(`${JSON.stringify({ checks: checks.length, errors: errors.length })}\n`);
} finally {
    await browser.close();
}
