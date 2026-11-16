import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.env.GPT_RECHARGE_VALIDATION_OUTPUT_DIR
    ? path.resolve(process.env.GPT_RECHARGE_VALIDATION_OUTPUT_DIR)
    : fileURLToPath(new URL('../../../../backups/gpt-recharge-refresh-20261116/browser/', import.meta.url));
const origin = process.env.GPT_RECHARGE_PREVIEW_ORIGIN || 'http://127.0.0.1:5187';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const [width, skin, language] of [
        [1440, 'classic', 'zh'],
        [390, 'classic', 'zh'],
        [1440, 'neo-minimalist', 'en'],
        [390, 'neo-minimalist', 'en'],
    ]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
            reducedMotion: language === 'en' ? 'reduce' : 'no-preference',
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // Observe the actual component on every frame, including hard reloads.
        await page.addInitScript(() => {
            window.refreshFrames = [];
            let first;
            function sample() {
                const field = document.querySelector('#gpt-code');
                const account = document.querySelector('#gpt-session');
                const verify = document.querySelector('.gpt-recharge-verify');
                if (field && account && verify) {
                    first ??= field;
                    window.refreshFrames.push({
                        codeY: field.getBoundingClientRect().y + scrollY,
                        accountY: account.getBoundingClientRect().y + scrollY,
                        disabled: verify.disabled,
                        sameNode: field === first,
                        panel: Boolean(document.querySelector('.gpt-recharge-result')),
                        overlay: Boolean(document.querySelector('.page-readiness-overlay')),
                    });
                }
                if (window.refreshFrames.length < 1000) requestAnimationFrame(sample);
            }
            requestAnimationFrame(sample);
        });
        const url = `${origin}/e2e/gpt-recharge/?skin=${skin}&language=${language}&config-delay=1800&presentation=1`;
        await page.goto(url);
        for (const phase of ['cold', 'reload']) {
            if (phase === 'reload') await page.reload();
            await page.locator('#gpt-code').waitFor();
            await expect(page.locator('.gpt-recharge-verify')).toBeDisabled();
            await expect(page.locator('.gpt-recharge-result')).toHaveCount(0);
            await expect(page.locator('.gpt-recharge-verify')).toHaveText(
                language === 'en' ? 'Verify code' : '验证兑换码',
            );
            await page.locator('#gpt-code').fill('draft-before-availability');
            await page.screenshot({
                path: path.join(output, `${width}-${skin}-${phase}-pending.png`),
                fullPage: true,
            });
            await expect(page.locator('.gpt-recharge-verify')).toBeEnabled();
            await expect(page.locator('#gpt-code')).toHaveValue('draft-before-availability');
            await expect(page.locator('.gpt-recharge-submit')).toBeDisabled();
            const frames = await page.evaluate(() => window.refreshFrames);
            assert(
                frames.some(frame => frame.disabled),
                'Expected frames before configuration resolved',
            );
            assert(frames.every(frame => frame.sameNode && !frame.panel && !frame.overlay));
            for (const coordinate of ['codeY', 'accountY']) {
                const values = frames.map(frame => frame[coordinate]);
                assert(
                    Math.max(...values) - Math.min(...values) <= 0.5,
                    `${coordinate} moved during ${phase}`,
                );
            }
            await page.screenshot({
                path: path.join(output, `${width}-${skin}-${phase}-ready.png`),
                fullPage: true,
            });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await expect(page.locator('[data-demo-verify-calls]')).toHaveAttribute(
                'data-demo-verify-calls',
                '0',
            );
            await expect(page.locator('[data-demo-submit-calls]')).toHaveAttribute(
                'data-demo-submit-calls',
                '0',
            );
            results.push({ width, skin, language, phase, frames: frames.length, stable: true });
        }
        // Tab A -> B -> A keeps a usable form and does not restart the initial wait.
        await page
            .getByRole('button', { name: language === 'en' ? 'Code lookup' : '兑换码查询', exact: true })
            .click();
        await page.locator('#gpt-query').waitFor();
        await page
            .getByRole('button', { name: language === 'en' ? 'Recharge' : '自助充值', exact: true })
            .click();
        await expect(page.locator('#gpt-code')).toHaveValue('draft-before-availability');
        await expect(page.locator('.gpt-recharge-verify')).toBeEnabled();
        assert.deepEqual(errors, []);
        await page.close();
    }
    const slow = await browser.newPage({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' });
    await slow.goto(`${origin}/e2e/gpt-recharge/?config-delay=11500&presentation=1`);
    await expect(slow.locator('.gpt-recharge-verify')).toHaveText('验证兑换码');
    const before = await slow.locator('#gpt-session').boundingBox();
    await expect(slow.locator('.gpt-recharge-verify')).toContainText('服务响应较慢', { timeout: 11000 });
    const during = await slow.locator('#gpt-session').boundingBox();
    assert.deepEqual(during, before, 'The slow-read hint must not move the account field');
    await expect(slow.locator('.gpt-recharge-result')).toHaveCount(0);
    await expect(slow.locator('.page-readiness-overlay')).toHaveCount(0);
    await slow.screenshot({ path: path.join(output, 'mobile-slow-read.png'), fullPage: true });
    await expect(slow.locator('.gpt-recharge-verify')).toBeEnabled();
    await expect(slow.locator('.gpt-recharge-verify')).toHaveText('验证兑换码');
    results.push({ scenario: 'slow-local-hint', stable: true });
    await slow.close();

    for (const [availability, title] of [
        ['maintenance', '充值服务维护中'],
        ['disabled', '充值服务暂未开放'],
        ['error', '暂时无法确认充值服务状态'],
    ]) {
        const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
        await page.goto(`${origin}/e2e/gpt-recharge/?availability=${availability}`);
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#gpt-code')).toHaveCount(0);
        await page.getByRole('button', { name: '查询已有任务', exact: true }).click();
        await expect(page.locator('#gpt-query')).toBeVisible();
        await expect(page.locator('[data-demo-submit-calls]')).toHaveAttribute('data-demo-submit-calls', '0');
        results.push({ scenario: availability, existingTaskLookup: true });
        await page.close();
    }
    await writeFile(
        path.join(output, 'results.json'),
        JSON.stringify(
            {
                source: 'Actual component with synthetic service configuration; no business requests',
                results,
            },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} catch (error) {
    await writeFile(path.join(output, 'failure.txt'), String(error.stack || error));
    throw error;
} finally {
    await browser.close();
}
