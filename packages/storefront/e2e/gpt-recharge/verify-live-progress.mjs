import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const origin = process.env.GPT_RECHARGE_PREVIEW_ORIGIN || 'http://127.0.0.1:5216';
const output =
    process.env.GPT_RECHARGE_VALIDATION_OUTPUT_DIR ||
    fileURLToPath(new URL('../../../../outputs/recharge-live-progress-20261116/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const submissionOnly = process.argv.includes('--submission-only');
try {
    for (const [width, skin, language] of [
        [1440, 'classic', 'zh'],
        [390, 'classic', 'zh'],
        [320, 'neo-minimalist', 'en'],
        [1440, 'neo-minimalist', 'en'],
    ]) {
        if (submissionOnly) break;
        const page = await browser.newPage({ viewport: { width, height: 1100 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() =>
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { readText: async () => '  DEMO-PLUS-001  ', writeText: async () => undefined },
            }),
        );
        await page.goto(`${origin}/e2e/gpt-recharge/?detailed=1&skin=${skin}&language=${language}`);
        await page.locator('.gpt-recharge-tabs button').nth(1).click();
        await page.locator('.gpt-recharge-query .gpt-recharge-paste').click();
        await expect(page.locator('#gpt-query')).toHaveValue('DEMO-PLUS-001');
        await expect(page.locator('[data-demo-query-calls]')).toHaveAttribute('data-demo-query-calls', '0');
        await page.locator('.gpt-recharge-query form .primary-action').click();
        await expect(page.locator('.gpt-recharge-timeline li')).toHaveCount(8);
        await expect(page.locator('.gpt-recharge-sync')).toHaveText(
            language === 'zh' ? '已连接' : 'Connected',
        );
        await expect(page.locator('.gpt-recharge-task-details')).toContainText(
            'customer-with-a-long-email-address@example.test',
        );
        for (const index of [3, 4])
            await expect(page.locator('.gpt-recharge-timeline li').nth(index)).toHaveAttribute(
                'data-state',
                'complete',
            );
        await expect(page.locator('.gpt-recharge-timeline li').nth(5)).toHaveAttribute(
            'data-state',
            'waiting',
        );
        if (width === 1440 && language === 'zh') {
            await page.waitForTimeout(6500);
            await expect(page.locator('[data-demo-task-calls]')).toHaveAttribute('data-demo-task-calls', '0');
            await page.locator('.gpt-recharge-progress-tools button').click();
            await expect(page.locator('[data-demo-task-calls]')).toHaveAttribute('data-demo-task-calls', '1');
            await expect(page.locator('[data-demo-submit-calls]')).toHaveAttribute(
                'data-demo-submit-calls',
                '0',
            );
        }
        const metrics = await page.evaluate(() => {
            const rect = selector => {
                const r = document.querySelector(selector).getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
            };
            return {
                viewport: innerWidth,
                scroll: document.documentElement.scrollWidth,
                input: rect('#gpt-query'),
                paste: rect('.gpt-recharge-query .gpt-recharge-paste'),
                left: rect('.gpt-recharge-query-input'),
                right: rect('.gpt-recharge-progress-rail'),
                details: rect('.gpt-recharge-task-details'),
            };
        });
        expect(metrics.scroll).toBeLessThanOrEqual(width);
        expect(Math.abs(metrics.input.height - metrics.paste.height)).toBeLessThanOrEqual(1);
        if (width >= 960) expect(metrics.right.x).toBeGreaterThan(metrics.left.x + metrics.left.width);
        else {
            expect(metrics.right.y).toBeGreaterThan(metrics.left.y);
            expect(metrics.details.y).toBeGreaterThan(metrics.right.y);
        }
        await page
            .locator('.gpt-recharge-page')
            .screenshot({ path: resolve(output, `query-${width}-${skin}-${language}.png`) });
        await page.locator('#gpt-query').fill('DEMO-OTHER');
        await expect(page.locator('.gpt-recharge-progress-rail')).toContainText(
            language === 'zh' ? '当前显示上次查询结果' : 'Showing the previous result',
        );
        await expect(page.locator('.gpt-recharge-timeline li')).toHaveCount(8);
        await page.locator('.gpt-recharge-tabs button').nth(2).click();
        await expect(page.locator('.gpt-recharge-timeline li')).toHaveCount(8);
        await expect(page.locator('.gpt-recharge-progress')).toHaveCount(1);
        expect(errors).toEqual([]);
        results.push({ width, skin, language, metrics });
        await page.close();
    }
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1100 } });
        await page.goto(origin + '/e2e/gpt-recharge/?detailed=1');
        await expect(page.locator('.gpt-recharge-progress-empty')).toBeVisible();
        await page.getByRole('button', { name: '填入演示资料', exact: true }).click();
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await page.getByRole('checkbox').check();
        await page
            .locator('.gpt-recharge-page')
            .screenshot({ path: resolve(output, `submit-form-${width}.png`) });
        await page.getByRole('button', { name: '充值提交', exact: true }).click();
        await expect(page.locator('.gpt-recharge-timeline li')).toHaveCount(8);
        await expect(page.locator('.gpt-recharge-current-step')).toContainText('已提交，等待处理结果');
        await expect(page.locator('.gpt-recharge-task-details')).toContainText(
            'customer-with-a-long-email-address@example.test',
        );
        await expect(page.locator('[data-demo-submit-calls]')).toHaveAttribute('data-demo-submit-calls', '1');
        await page
            .locator('.gpt-recharge-page')
            .screenshot({ path: resolve(output, `submitted-${width}.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const reference = await page.locator('.gpt-recharge-reference dd').textContent();
        await page.locator('.gpt-recharge-tabs button').nth(1).click();
        await page.locator('#gpt-query').fill('DEMO-PLUS-001');
        await page.locator('.gpt-recharge-query form .primary-action').click();
        await expect(page.locator('.gpt-recharge-reference dd')).toHaveText(reference);
        await expect(page.locator('.gpt-recharge-progress')).toHaveCount(1);
        for (const state of ['awaiting_review', 'failed', 'succeeded']) {
            await page.getByLabel('结果演示').selectOption(state);
            await page.locator('.gpt-recharge-progress-tools button').click();
            await expect(page.locator('.gpt-recharge-progress')).toHaveAttribute('data-status', state);
            await expect(
                page.locator(
                    '.gpt-recharge-timeline li[data-state="active"], .gpt-recharge-timeline li[data-state="waiting"]',
                ),
            ).toHaveCount(0);
        }
        await expect(page.locator('.gpt-recharge-sync')).toHaveText('已结束');
        await page.close();
    }
    const deniedPage = await browser.newPage();
    await deniedPage.addInitScript(() =>
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: async () => {
                    throw new DOMException('Denied', 'NotAllowedError');
                },
            },
        }),
    );
    await deniedPage.goto(origin + '/e2e/gpt-recharge/?detailed=1');
    await deniedPage.locator('.gpt-recharge-tabs button').nth(1).click();
    await deniedPage.locator('#gpt-query').fill('KEEP-CODE');
    await deniedPage.locator('.gpt-recharge-query .gpt-recharge-paste').click();
    await expect(deniedPage.locator('#gpt-query')).toHaveValue('KEEP-CODE');
    await expect(deniedPage.locator('#gpt-query-error')).toContainText('手动粘贴');
    await expect(deniedPage.locator('[data-demo-query-calls]')).toHaveAttribute('data-demo-query-calls', '0');
    await deniedPage.close();
    await writeFile(
        resolve(output, submissionOnly ? 'browser-submission-results.json' : 'browser-results.json'),
        JSON.stringify(
            {
                source: 'Actual components with synthetic task client; no live recharge',
                results,
                submitWidths: [1440, 390],
                terminalStates: ['awaiting_review', 'failed', 'succeeded'],
                clipboardDenial: true,
            },
            null,
            2,
        ),
    );
    process.stdout.write(
        `Passed ${results.length} query layouts, 2 submission layouts, terminal states and clipboard denial\n`,
    );
} finally {
    await browser.close();
}
