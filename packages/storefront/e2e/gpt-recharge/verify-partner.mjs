import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.GPT_RECHARGE_PREVIEW_ORIGIN || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ headless: true });
try {
    for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const unexpected = [];
        await context.route('**/*', route => {
            const href = route.request().url();
            if (href.startsWith(origin + '/')) return route.continue();
            unexpected.push(new URL(href).origin);
            return route.abort();
        });
        const page = await context.newPage();
        await page.goto(origin + '/e2e/gpt-recharge/');
        await page.locator('#gpt-code').fill('RA-' + 'A'.repeat(32));
        await expect(page.locator('#gpt-session')).toHaveCount(0);
        const create = page.getByRole('button', { name: '生成授权链接', exact: true });
        await expect(create).toBeDisabled();
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await expect(page.locator('.gpt-recharge-plan-list [aria-current]')).toHaveText('Pro500');
        await expect(create).toBeEnabled();
        await create.click();
        await expect(page.getByRole('heading', { name: '等待账号授权', exact: true })).toBeVisible();
        await expect(page.locator('.gpt-recharge-stages [aria-current="step"]')).toContainText('确认账号');
        await expect(
            page.locator('.gpt-recharge-task-details').getByText('Pro500', { exact: true }),
        ).toBeVisible();
        const link = page.getByRole('link', { name: '前往 ID 系统授权' });
        await expect(link).toHaveAttribute('href', 'https://id.example.test/recharge/authorize#fixture');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(page.locator('#gpt-session')).toHaveCount(0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(unexpected, []);
        await context.close();
    }
    process.stdout.write(
        'Partner authorization in the real storefront component passed at 1440px and 390px\n',
    );
} finally {
    await browser.close();
}
