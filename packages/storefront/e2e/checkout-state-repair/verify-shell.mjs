import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../test-results/recharge-shell-20261026/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
let activePage;
let activeErrors;
try {
    for (const width of [390, 1440]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        const page = await context.newPage();
        const errors = [];
        activePage = page;
        activeErrors = errors;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route =>
            new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
        );
        await page.goto('http://127.0.0.1:5188/e2e/checkout-state-repair/?view=gpt-shell');
        await expect(page.getByTestId('recharge-route-ready')).toHaveAttribute('data-committed', 'true');
        const input = page.locator('#gpt-code');
        await expect(input).toBeVisible();
        await input.fill('SYNTHETIC-SHELL-DRAFT');
        const original = await input.elementHandle();
        for (const english of [true, false]) {
            await page
                .getByRole('button', {
                    name: english ? '语言与货币：简体中文，CNY' : 'Language and currency: English, CNY',
                    exact: true,
                })
                .click();
            await page.getByRole('radio', { name: english ? '英文' : 'ZH', exact: true }).click();
            await page
                .getByRole('button', { name: english ? '保存设置' : 'Save preferences', exact: true })
                .click();
            await expect(page.getByTestId('resolve-brand')).toBeEnabled();
            await expect(input).toHaveValue('SYNTHETIC-SHELL-DRAFT');
            expect(await original.evaluate(node => node.isConnected)).toBe(true);
            await page.getByTestId('resolve-brand').click();
            await expect(page.getByTestId('resolve-brand')).toBeDisabled();
            await expect(input).toHaveValue('SYNTHETIC-SHELL-DRAFT');
            expect(await original.evaluate(node => node.isConnected)).toBe(true);
        }
        await page.screenshot({ path: `${output}${width}-retained.png`, fullPage: true });
        await page.reload();
        await expect(page.getByTestId('recharge-route-ready')).toHaveAttribute('data-committed', 'true');
        await expect(input).toHaveValue('');
        expect(errors).toEqual([]);
        results.push({
            width,
            languageDirections: ['zh→en', 'en→zh'],
            reloadCleared: true,
            pageErrors: errors,
        });
        await context.close();
    }
    await writeFile(`${output}results.json`, JSON.stringify(results, null, 2));
    process.stdout.write(JSON.stringify(results));
} catch (error) {
    await activePage?.screenshot({ path: `${output}failure.png`, fullPage: true });
    await writeFile(
        `${output}failure.json`,
        JSON.stringify(
            {
                errors: activeErrors,
                url: activePage?.url(),
                text: await activePage?.locator('body').innerText(),
            },
            null,
            2,
        ),
    );
    throw error;
} finally {
    await browser.close();
}
