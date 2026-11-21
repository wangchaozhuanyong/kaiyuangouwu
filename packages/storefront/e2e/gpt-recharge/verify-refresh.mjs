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
            viewport: { width, height: width === 390 ? 844 : 1000 },
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
            if (phase === 'cold') {
                const header = page.locator('.gpt-recharge-hero h1');
                await expect(header).toHaveText(language === 'en' ? 'ChatGPT Recharge' : 'ChatGPT 自助充值');
                if (width === 390) {
                    const textCenter = await header.evaluate(node => {
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        const bounds = range.getBoundingClientRect();
                        return bounds.left + bounds.width / 2;
                    });
                    assert(Math.abs(textCenter - width / 2) < 3, 'The mobile title should be centered');
                    const plans = page.locator('.gpt-recharge-plan-panel');
                    await expect(plans.getByText('Pro500', { exact: true })).toBeVisible();
                    await expect(plans.getByRole('listitem')).toHaveText([
                        'Plus',
                        'Pro100',
                        'Pro200',
                        'Pro500',
                    ]);
                    const plansBottom = await plans.evaluate(
                        node => node.getBoundingClientRect().bottom + scrollY,
                    );
                    assert(
                        plansBottom <= 844,
                        'The plan specifications should fit on the first mobile screen',
                    );
                } else {
                    const frame = await page.evaluate(() => {
                        const rect = selector => document.querySelector(selector).getBoundingClientRect();
                        const pageHeading = document.querySelector('.subpage-header > strong');
                        const background = selector =>
                            getComputedStyle(document.querySelector(selector)).backgroundColor;
                        return {
                            brandLeft: rect('.proto-header-inner > :first-child').left,
                            headerRight: rect('.proto-header-inner > :last-child').right,
                            backLeft: rect('.gpt-recharge-page .page-back-button').left,
                            headingTop: rect('.subpage-header').top,
                            headingBottom: rect('.subpage-header').bottom,
                            headingFits: pageHeading.scrollWidth <= pageHeading.clientWidth,
                            heroTop: rect('.gpt-recharge-hero').top,
                            navigationTop: rect('.gpt-recharge-tabs').top,
                            railLeft: rect('.gpt-recharge-tabs').left,
                            heroRight: rect('.gpt-recharge-hero').right,
                            workspaceRight: rect('.gpt-recharge-workspace').right,
                            canvas: [
                                'html',
                                '.storefront-app',
                                '.desktop-shell-frame',
                                '.gpt-recharge-page',
                            ].map(background),
                        };
                    });
                    assert(frame.headingFits, 'The recharge center title should fit in the navigation rail');
                    assert(Math.abs(frame.headingTop - frame.heroTop) <= 1, 'Start both columns together');
                    assert(
                        Math.abs(frame.navigationTop - frame.headingBottom) <= 1,
                        'Place navigation directly below the return control',
                    );
                    for (const left of [frame.backLeft, frame.railLeft]) {
                        assert(Math.abs(left - frame.brandLeft) <= 1, 'Align with the storefront brand');
                    }
                    for (const right of [frame.heroRight, frame.workspaceRight]) {
                        assert(Math.abs(right - frame.headerRight) <= 1, 'Align with the last header action');
                    }
                    assert.equal(new Set(frame.canvas).size, 1, 'The page and both gutters share a canvas');
                    const navigation = await page.locator('.gpt-recharge-tabs').boundingBox();
                    const work = await page.locator('.gpt-recharge-workspace').boundingBox();
                    assert(
                        navigation && work && navigation.x + navigation.width <= work.x,
                        'Desktop navigation should sit beside the workspace',
                    );
                }
            }
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
        if (width === 390) {
            const more = page.getByRole('button', { name: language === 'en' ? 'More' : '更多', exact: true });
            const support = language === 'en' ? 'Contact support' : '联系客服';
            await expect(page.getByRole('button', { name: support, exact: true })).toHaveCount(0);
            await more.click();
            const actions = page.getByRole('dialog', {
                name: language === 'en' ? 'More actions' : '更多操作',
            });
            await expect(actions.getByRole('button', { name: support, exact: true })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(actions).toHaveCount(0);
            await expect(more).toBeFocused();
            await more.click();
            await actions.getByRole('button', { name: support, exact: true }).click();
            await expect(page.locator('.gpt-preview-caption')).toContainText(
                language === 'en' ? 'support' : '客服',
            );
            await expect(actions).toHaveCount(0);
        }
        assert.deepEqual(errors, []);
        await page.close();
    }
    const direct = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await direct.goto(origin + '/e2e/gpt-recharge/');
    await direct.getByRole('button', { name: '填入演示资料' }).click();
    const activeStep = direct.locator('.gpt-recharge-stages [aria-current="step"]');
    await expect(activeStep).toContainText('验证兑换码');
    await direct.locator('#gpt-code').fill('DEMO-500');
    await direct.getByRole('button', { name: '验证兑换码', exact: true }).click();
    await expect(direct.locator('.gpt-recharge-plan-list [aria-current]')).toHaveText('Pro500');
    await expect(activeStep).toContainText('确认账号');
    await expect(direct.locator('.gpt-recharge-plan-list button')).toHaveCount(0);
    await direct.getByRole('checkbox').check();
    await direct.getByRole('button', { name: '充值提交', exact: true }).click();
    const taskPlan = direct.locator('.gpt-recharge-task-details').getByText('Pro500', { exact: true });
    await expect(taskPlan).toBeVisible();
    await expect(activeStep).toContainText('查看进度');
    await direct.getByLabel('结果演示').selectOption('succeeded');
    await direct.getByRole('button', { name: '兑换码查询', exact: true }).click();
    await expect(direct.locator('.gpt-recharge-stages')).toHaveCount(0);
    await direct.locator('#gpt-query').fill('DEMO-500');
    await direct.getByRole('button', { name: '查询进度', exact: true }).click();
    await expect(direct.getByRole('heading', { name: '充值成功', exact: true })).toBeVisible();
    await expect(taskPlan).toBeVisible();
    await expect(direct.locator('[data-demo-submit-calls]')).toHaveAttribute('data-demo-submit-calls', '1');
    results.push({ scenario: 'pro500-direct', plan: 'Pro500', submitCalls: 1, queriedStatus: 'succeeded' });
    await direct.close();

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
