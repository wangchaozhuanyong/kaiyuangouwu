import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../test-results/checkout-state-repair-20261026/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
const base = 'http://127.0.0.1:5188/e2e/checkout-state-repair/';
try {
    for (const [width, language, preset] of [
        [390, 'zh', 'classic'],
        [390, 'en', 'neo-minimalist'],
        [1440, 'zh', 'neo-minimalist'],
        [1440, 'en', 'classic'],
    ]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        const page = await context.newPage();
        page.setDefaultTimeout(7_000);
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route =>
            new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
        );
        const open = view => page.goto(`${base}?view=${view}&language=${language}&preset=${preset}`);
        const counters = async () => JSON.parse(await page.getByTestId('counters').textContent());
        const screenshot = name =>
            page.screenshot({ path: `${output}${width}-${language}-${preset}-${name}.png`, fullPage: true });
        const zh = language === 'zh';

        if (process.env.REPAIR_BROWSER_SCOPE !== 'support') {
            await open('gpt');
            await page.locator('#gpt-code').fill('SYNTHETIC-DRAFT');
            await page.getByRole('button', { name: 'Toggle language', exact: true }).click();
            await expect(page.locator('#gpt-code')).toHaveValue('SYNTHETIC-DRAFT');
            await page.getByRole('button', { name: 'Toggle language', exact: true }).click();
            await expect(page.locator('#gpt-code')).toHaveValue('SYNTHETIC-DRAFT');
            await screenshot('gpt');
            checks.push(`${width}/${language}/${preset}: recharge route language draft`);

            await open('checkout');
            const emailPicker = page.locator('.digital-delivery-email-trigger');
            await emailPicker.click();
            await page
                .getByRole('radio')
                .filter({ hasText: zh ? '使用新邮箱' : 'Use a new email' })
                .click();
            await page.locator('[name="deliveryEmail"]').fill('new@example.test');
            await page.locator('[name="confirmDeliveryEmail"]').fill('new@example.test');
            await page.locator('[name="saveDeliveryEmail"]').uncheck();
            await page.getByRole('button', { name: 'Refresh customer', exact: true }).click();
            await expect(page.locator('[name="deliveryEmail"]')).toHaveValue('new@example.test');
            await expect(page.locator('[name="confirmDeliveryEmail"]')).toHaveValue('new@example.test');
            await expect(page.locator('[name="saveDeliveryEmail"]')).not.toBeChecked();
            await screenshot('email');
            await emailPicker.click();
            await page.getByRole('radio').filter({ hasText: 'work@example.test' }).click();
            await page.getByRole('button', { name: 'Refresh customer', exact: true }).click();
            await expect(emailPicker).toContainText('work@example.test');
            checks.push(`${width}/${language}/${preset}: new and saved email survive refresh`);
            await page.getByRole('button', { name: zh ? /订单备注/ : /Order note/ }).click();
            await page.locator('textarea').fill('Synthetic note');
            await page.getByRole('button', { name: zh ? '保存备注' : 'Save note', exact: true }).click();
            await expect(page.getByRole('alert')).toContainText(
                zh ? '订单备注已保存，但读取更新失败' : 'Order note saved, but refresh failed',
            );
            expect((await counters()).noteWrites).toBe(1);
            // Restore through the fixture without interacting with the background while a sheet is open.
            await page.evaluate(() =>
                document.querySelector('[data-testid="fixture-controls"] button:nth-of-type(4)').click(),
            );
            await page.getByRole('button', { name: zh ? '重试读取' : 'Retry refresh', exact: true }).click();
            await expect(page.getByTestId('notice')).toContainText(
                zh ? '订单备注已保存' : 'Order note saved',
            );
            expect((await counters()).noteWrites).toBe(1);
            checks.push(`${width}/${language}/${preset}: saved note retry performs no write`);

            await open('payment');
            await expect(page.getByText('Synthetic card', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Toggle currency', exact: true }).click();
            await expect(page.getByText('Synthetic card', { exact: true })).toHaveCount(0);
            await expect.poll(async () => (await counters()).methodReads).toBe(2);
            await page.getByRole('button', { name: 'Toggle currency', exact: true }).click();
            await expect(page.getByText('Synthetic card', { exact: true })).toBeVisible();
            await screenshot('payment');
            checks.push(`${width}/${language}/${preset}: same-order currency query roundtrip`);
        }
        await open('support');
        await page.locator('.support-evaluation-submit-btn').click();
        await expect(page.getByRole('alert')).toHaveCount(1);
        await expect(page.getByRole('alert')).toContainText(
            zh ? '请先选择服务评分' : 'Choose a service rating',
        );
        expect((await counters()).reviews).toBe(0);
        await screenshot('feedback');
        await page.getByRole('button', { name: '5 star', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await page.locator('.support-evaluation-submit-btn').click();
        await expect.poll(async () => (await counters()).reviews).toBe(1);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: () => Promise.reject(new Error('Synthetic permission denial')) },
            });
        });
        await page.locator('.support-order-banner-copy').click();
        await expect(page.getByTestId('notice')).toContainText(zh ? '复制失败' : 'Could not copy');
        checks.push(
            `${width}/${language}/${preset}: single validation error, correction, clipboard rejection`,
        );
        await context.close();
    }
    const storageContext = await browser.newContext();
    const storagePage = await storageContext.newPage();
    storagePage.on('pageerror', error => errors.push(error.message));
    await storagePage.addInitScript(() => {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = () => {
            throw new Error('Synthetic storage denial');
        };
        window.restoreFixtureStorage = () => {
            Storage.prototype.getItem = original;
        };
    });
    await storagePage.goto(`${base}?view=support`);
    await expect(storagePage.getByRole('alert')).toContainText('无法取得访客标识');
    await expect(storagePage.locator('[data-loading]')).toHaveAttribute('data-loading', 'false');
    await expect(storagePage.locator('.support-evaluation-submit-btn')).toBeDisabled();
    await storagePage.evaluate(() => window.restoreFixtureStorage());
    await storagePage.getByRole('button', { name: '重新检查', exact: true }).click();
    await expect(storagePage.locator('.support-evaluation-submit-btn')).toBeEnabled();
    checks.push('storage unavailable: loading ends and retry recovers');
    await storageContext.close();
    expect(errors).toEqual([]);
    await writeFile(
        `${output}${process.env.REPAIR_BROWSER_SCOPE === 'support' ? 'browser-support-results' : 'browser-results'}.json`,
        JSON.stringify(
            {
                source: 'Actual components and recharge route with synthetic in-memory APIs; no production requests',
                checks,
                errors,
            },
            null,
            2,
        ),
    );
    process.stdout.write(
        JSON.stringify({ checks: checks.length, pageErrors: errors.length, output }, null, 2),
    );
} catch (error) {
    await writeFile(
        `${output}browser-failure.json`,
        JSON.stringify({ error: String(error), completed: checks, pageErrors: errors }, null, 2),
    );
    throw error;
} finally {
    await browser.close();
}
