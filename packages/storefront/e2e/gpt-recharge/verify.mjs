import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.env.GPT_RECHARGE_VALIDATION_OUTPUT_DIR
    ? path.resolve(process.env.GPT_RECHARGE_VALIDATION_OUTPUT_DIR)
    : fileURLToPath(
          new URL('../../../../docs/local-validation/gpt-recharge-feedback-20261017/', import.meta.url),
      );
const origin = process.env.GPT_RECHARGE_PREVIEW_ORIGIN || 'http://127.0.0.1:5186';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const [width, height, skin] of [
        [1440, 1100, 'classic'],
        [390, 1100, 'classic'],
        [320, 1100, 'classic'],
        [1024, 1100, 'classic'],
        [390, 1100, 'neo-minimalist'],
    ]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                value: { readText: () => Promise.resolve('  DEMO-100  ') },
                configurable: true,
            });
        });
        await page.goto(`${origin}/e2e/gpt-recharge/?skin=${skin}`);
        await page.getByText('ChatGPT自助充值', { exact: true }).waitFor();
        await page.locator('#gpt-code').waitFor();
        const codeInput = page.locator('#gpt-code');
        const plans = page.getByRole('list', { name: '套餐类型' });
        const activePlan = plans.locator('[aria-current="true"]');
        const planStatus = page.locator('.gpt-recharge-plan-status');
        await expect(planStatus).toHaveText('验码后自动匹配');
        await expect(plans.getByRole('listitem')).toHaveCount(4);
        await expect(plans.getByRole('button')).toHaveCount(0);
        await expect(plans.getByText('暂未开放')).toBeVisible();
        await expect(activePlan).toHaveCount(0);
        const codeBounds = await codeInput.boundingBox();
        const planBounds = await plans.boundingBox();
        if (!codeBounds || !planBounds || codeBounds.y + codeBounds.height > planBounds.y)
            throw new Error('The verified plan must appear below the redemption code');
        const getJson = page.getByRole('link', { name: '前往获取 JSON', exact: true });
        await expect(getJson).toHaveAttribute('href', 'https://chatgpt.com/api/auth/session');
        await expect(getJson).toHaveAttribute('target', '_blank');
        await expect(getJson).toHaveAttribute('rel', 'noopener noreferrer');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `recharge-${width}-${skin}.png`), fullPage: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        if (overflow) throw new Error(`Horizontal overflow at ${width}/${skin}`);
        const verifyButton = page.getByRole('button', { name: '验证兑换码', exact: true });
        await page.getByRole('button', { name: '粘贴', exact: true }).click();
        await expect(codeInput).toHaveValue('DEMO-100');
        await expect(codeInput).toBeFocused();
        await expect(page.locator('[data-demo-verify-calls]')).toHaveAttribute('data-demo-verify-calls', '0');
        await expect(activePlan).toHaveCount(0);
        await verifyButton.click();
        await expect(activePlan).toHaveText('Pro100');
        await expect(planStatus).toHaveText('已匹配 Pro100');
        await codeInput.fill('DEMO-200');
        await expect(activePlan).toHaveCount(0);
        await verifyButton.click();
        await expect(activePlan).toHaveText('Pro200');
        await page.locator('#gpt-code').fill('INVALID');
        await expect(planStatus).toHaveText('验码后自动匹配');
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await expect(page.locator('#gpt-verify-error')).toBeVisible();
        await expect(activePlan).toHaveCount(0);
        await codeInput.fill('DEMO-INVALID');
        await verifyButton.click();
        await expect(page.getByRole('alert')).toHaveText('兑换码无效或已停用，请核对后重试。');
        await codeInput.fill('DEMO-HELD');
        await verifyButton.click();
        await expect(page.getByRole('heading', { name: '上次开通结果待核对', exact: true })).toBeVisible();
        await expect(page.locator('#gpt-query')).toHaveValue('DEMO-HELD');
        await expect(page.locator('[data-demo-query-calls]')).toHaveAttribute('data-demo-query-calls', '0');
        await page.getByRole('button', { name: '查询充值结果' }).click();
        await expect(page.locator('[data-demo-query-calls]')).toHaveAttribute('data-demo-query-calls', '1');
        await expect(page.getByRole('heading', { name: '上次开通结果待核对', exact: true })).toBeVisible();
        const retry = page.getByRole('button', { name: '使用原码重新充值', exact: true });
        await expect(retry).toHaveCount(0);
        await page.locator('#gpt-query').fill('DEMO-REVIEWED');
        await page.getByRole('button', { name: '查询充值结果' }).click();
        await expect(page.getByRole('heading', { name: '本次充值未完成', exact: true })).toBeVisible();
        await expect(retry).toBeVisible();
        await expect(retry).toBeEnabled();
        if (
            !(await retry.evaluate(button => {
                const bounds = button.getBoundingClientRect();
                return bounds.left >= 0 && bounds.right <= innerWidth;
            }))
        )
            throw new Error('Retry button extends beyond the viewport');
        await page.screenshot({
            path: path.join(output, `reviewed-retry-${width}-${skin}.png`),
            fullPage: true,
        });
        await page.getByRole('button', { name: '自助充值', exact: true }).click();
        await codeInput.fill('DEMO-DIFFERENT');
        await page.getByRole('button', { name: '兑换码查询', exact: true }).click();
        await page.locator('#gpt-query').fill('DEMO-DIFFERENT');
        await expect(page.locator('#gpt-query')).toHaveValue('DEMO-DIFFERENT');
        await expect(retry).toHaveCount(0);
        await page.locator('#gpt-query').fill('DEMO-REVIEWED');
        await page.getByRole('button', { name: '查询充值结果' }).click();
        await retry.click();
        await expect(codeInput).toHaveValue('DEMO-REVIEWED');
        await expect(codeInput).toBeFocused();
        await expect(page.locator('#gpt-session')).toHaveValue('');
        await expect(page.getByRole('button', { name: '充值提交', exact: true })).toBeDisabled();
        await expect(page.locator('[data-demo-submit-calls]')).toHaveAttribute('data-demo-submit-calls', '0');
        await page.getByRole('button', { name: '自助充值', exact: true }).click();
        await page.getByRole('button', { name: '填入演示资料' }).click();
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await expect(activePlan).toHaveText('Plus');
        await page.locator('#gpt-session').fill('{');
        await page.getByText('JSON 格式不完整，请重新全选复制账号资料。').waitFor();
        if (await page.getByRole('button', { name: '充值提交', exact: true }).isEnabled())
            throw new Error('Invalid JSON can submit');
        await page.getByRole('button', { name: '填入演示资料' }).click();
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await page.getByRole('checkbox').check();
        await page.waitForFunction(() =>
            [...document.querySelectorAll('button')].some(
                button => button.textContent?.includes('充值提交') && !button.disabled,
            ),
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `confirm-${width}-${skin}.png`), fullPage: true });
        await page.getByRole('button', { name: '充值提交', exact: true }).click();
        await page.getByRole('heading', { name: '已受理，等待处理' }).waitFor();
        await page.getByLabel('结果演示').selectOption('awaiting_review');
        await page.getByRole('button', { name: '刷新进度' }).click();
        await page.getByRole('heading', { name: '充值结果待核对' }).waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `review-${width}-${skin}.png`), fullPage: true });
        for (const [state, title] of [
            ['running', '正在为你充值'],
            ['failed', '本次充值未完成'],
            ['succeeded', '充值成功'],
        ]) {
            await page.getByLabel('结果演示').selectOption(state);
            await page.getByRole('button', { name: '刷新进度' }).click();
            await page.getByRole('heading', { name: title, exact: true }).waitFor();
        }
        await page.getByRole('button', { name: '兑换码查询', exact: true }).click();
        await page.locator('#gpt-query').fill('DEMO-PLUS-001');
        await page.getByRole('button', { name: '查询充值结果' }).click();
        await page.getByRole('heading', { name: '充值成功', exact: true }).waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `query-${width}-${skin}.png`), fullPage: true });
        await page.getByRole('button', { name: '使用说明', exact: true }).click();
        await page.getByRole('heading', { name: '充值使用说明', exact: true }).waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `guide-${width}-${skin}.png`), fullPage: true });
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
            throw new Error(`Guide overflow at ${width}`);
        if (errors.length) throw new Error(errors.join('\n'));
        results.push({ width, height, skin, overflow: false, interactions: 'passed', consoleErrors: errors });
        await page.close();
    }
    const shortPage = await browser.newPage({ viewport: { width: 390, height: 600 } });
    await shortPage.goto(`${origin}/e2e/gpt-recharge/`);
    await shortPage.locator('#gpt-code').fill('DEMO-200');
    const shortVerify = shortPage.getByRole('button', { name: '验证兑换码', exact: true });
    await shortVerify.evaluate(button => button.scrollIntoView({ block: 'end', behavior: 'instant' }));
    const pro200 = shortPage.getByRole('listitem').filter({ hasText: 'Pro200' });
    await expect(pro200).not.toBeInViewport();
    await shortVerify.click();
    await expect(pro200).toHaveAttribute('aria-current', 'true');
    await expect(pro200).toBeInViewport({ ratio: 1 });
    await shortPage.close();
    const repeatPage = await browser.newPage({ viewport: { width: 390, height: 1100 } });
    await repeatPage.goto(`${origin}/e2e/gpt-recharge/?error=verify-repeat`);
    await repeatPage.locator('#gpt-code').waitFor();
    await repeatPage.getByRole('button', { name: '填入演示资料' }).click();
    const verifyCode = repeatPage.getByRole('button', { name: '验证兑换码', exact: true });
    const submit = repeatPage.getByRole('button', { name: '充值提交', exact: true });
    const confirmation = repeatPage.getByRole('checkbox');
    const verifiedPlan = repeatPage.locator('.gpt-recharge-plan-list [aria-current="true"]');
    await verifyCode.click();
    await expect(verifiedPlan).toHaveText('Plus');
    await confirmation.check();
    await expect(submit).toBeEnabled();
    await verifyCode.click();
    await expect(repeatPage.locator('#gpt-verify-error')).toBeVisible();
    await expect(verifiedPlan).toHaveCount(0);
    await expect(confirmation).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await repeatPage.close();
    const blockedClipboardPage = await browser.newPage({ viewport: { width: 390, height: 1100 } });
    await blockedClipboardPage.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { readText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
            configurable: true,
        });
    });
    await blockedClipboardPage.goto(origin + '/e2e/gpt-recharge/');
    await blockedClipboardPage.getByRole('button', { name: '粘贴', exact: true }).click();
    const manualCode = blockedClipboardPage.locator('#gpt-code');
    await expect(blockedClipboardPage.locator('#gpt-verify-error')).toHaveText(
        '无法读取剪贴板，请在输入框手动粘贴。',
    );
    await expect(manualCode).toBeFocused();
    await manualCode.fill('DEMO-PLUS');
    await blockedClipboardPage.getByRole('button', { name: '验证兑换码', exact: true }).click();
    await expect(blockedClipboardPage.locator('.gpt-recharge-plan-list [aria-current="true"]')).toHaveText(
        'Plus',
    );
    await blockedClipboardPage.close();
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1100 } });
        await page.goto(`${origin}/e2e/gpt-recharge/?error=verify-code-rejected`);
        const code = page.locator('#gpt-code');
        await code.fill('DEMO-PLUS');
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await expect(page.locator('#gpt-code-error')).toHaveText('兑换码无效或已停用，请核对后重试。');
        await expect(code).toBeFocused();
        await expect(page.getByRole('button', { name: '充值提交', exact: true })).toBeDisabled();
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
            throw new Error(`Code rejection feedback overflow at ${width}`);
        await page.close();
    }
    for (const [width, skin, language] of [
        [1440, 'classic', 'zh'],
        [390, 'classic', 'zh'],
        [1440, 'neo-minimalist', 'en'],
        [390, 'neo-minimalist', 'en'],
    ]) {
        const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
        const en = language === 'en';
        await page.goto(`${origin}/e2e/gpt-recharge/?skin=${skin}&language=${language}`);
        await page.getByRole('button', { name: en ? 'Code lookup' : '兑换码查询', exact: true }).click();
        await page.getByLabel('结果演示').selectOption('running');
        await page.getByLabel('步骤演示').selectOption('payment_details');
        await page.locator('#gpt-query').fill('DEMO-PLUS-001');
        await page.getByRole('button', { name: en ? 'Look up result' : '查询充值结果' }).click();
        await expect(page.locator('.gpt-recharge-current-step strong')).toHaveText(
            en ? 'Entering recharge details' : '正在填写充值资料',
        );
        await page.screenshot({
            path: path.join(output, `progress-${width}-${skin}-${language}.png`),
            fullPage: true,
        });
        if (width === 1440 && skin === 'classic') {
            const beforeHidden = await page
                .locator('[data-demo-task-calls]')
                .getAttribute('data-demo-task-calls');
            await page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', {
                    configurable: true,
                    get: () => 'hidden',
                });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            await page.waitForTimeout(3300);
            await expect(page.locator('[data-demo-task-calls]')).toHaveAttribute(
                'data-demo-task-calls',
                beforeHidden,
            );
            await page.evaluate(() => {
                delete document.visibilityState;
                document.dispatchEvent(new Event('visibilitychange'));
            });
            await expect
                .poll(async () =>
                    Number(await page.locator('[data-demo-task-calls]').getAttribute('data-demo-task-calls')),
                )
                .toBeGreaterThan(Number(beforeHidden));
            await page.context().setOffline(true);
            await page.evaluate(() => window.dispatchEvent(new Event('offline')));
            const beforeOffline = await page
                .locator('[data-demo-task-calls]')
                .getAttribute('data-demo-task-calls');
            await page.waitForTimeout(3300);
            await expect(page.locator('[data-demo-task-calls]')).toHaveAttribute(
                'data-demo-task-calls',
                beforeOffline,
            );
            await expect(page.getByText('网络已断开', { exact: true })).toBeVisible();
            await expect(page.locator('.gpt-recharge-current-step strong')).toHaveText('正在填写充值资料');
            await page.context().setOffline(false);
            await page.evaluate(() => window.dispatchEvent(new Event('online')));
            await expect
                .poll(async () =>
                    Number(await page.locator('[data-demo-task-calls]').getAttribute('data-demo-task-calls')),
                )
                .toBeGreaterThan(Number(beforeOffline));
            results.push({
                hiddenPollingStopped: true,
                offlinePollingStopped: true,
                reconnectReadOnly: true,
            });
        }
        await page.getByLabel('步骤演示').selectOption('subscription_check');
        await expect(page.locator('.gpt-recharge-current-step strong')).toHaveText(
            en ? 'Checking subscription status' : '正在确认订阅状态',
            { timeout: 6500 },
        );
        await expect(page.locator('[data-demo-submit-calls]')).toHaveAttribute('data-demo-submit-calls', '0');
        await expect(page.locator('[data-demo-query-calls]')).toHaveAttribute('data-demo-query-calls', '1');
        await page.getByLabel('结果演示').selectOption('succeeded');
        await expect(
            page.getByRole('heading', { name: en ? 'Recharge complete' : '充值成功', exact: true }),
        ).toBeVisible({ timeout: 6500 });
        const calls = await page.locator('[data-demo-task-calls]').getAttribute('data-demo-task-calls');
        await page.waitForTimeout(3300);
        await expect(page.locator('[data-demo-task-calls]')).toHaveAttribute('data-demo-task-calls', calls);
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
            throw new Error(`Progress overflow at ${width}/${skin}/${language}`);
        const inputBounds = await page.locator('.gpt-recharge-query-input').boundingBox();
        const resultBounds = await page.locator('.gpt-recharge-query-result').boundingBox();
        if (width >= 1024 && inputBounds.x + inputBounds.width > resultBounds.x)
            throw new Error('Desktop query and result columns overlap');
        if (width < 1024 && inputBounds.y + inputBounds.height > resultBounds.y)
            throw new Error('Mobile query and result sections overlap');
        results.push({
            width,
            skin,
            language,
            automaticProgress: true,
            terminalPollingStopped: true,
            rechargeWrites: 0,
        });
        await page.close();
    }
    const failed = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await failed.goto(`${origin}/e2e/gpt-recharge/?error=progress`);
    await failed.getByRole('button', { name: '兑换码查询', exact: true }).click();
    await failed.getByLabel('结果演示').selectOption('running');
    await failed.getByLabel('步骤演示').selectOption('payment_details');
    await failed.locator('#gpt-query').fill('DEMO-PLUS-001');
    await failed.getByRole('button', { name: '查询充值结果' }).click();
    await expect(failed.getByText('更新暂时中断', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(failed.locator('.gpt-recharge-current-step strong')).toHaveText('正在填写充值资料');
    await expect(failed.getByText('请确认登录状态', { exact: false })).toHaveCount(0);
    await expect(failed.getByText('Synthetic private progress failure', { exact: false })).toHaveCount(0);
    await expect(failed.locator('[data-demo-submit-calls]')).toHaveAttribute('data-demo-submit-calls', '0');
    await failed.screenshot({ path: path.join(output, 'progress-query-error.png'), fullPage: true });
    results.push({ updateFailureRetainsProgress: true, misleadingLoginMessage: false, rechargeWrites: 0 });
    await failed.close();
    await writeFile(
        path.join(output, 'browser-result.json'),
        JSON.stringify(
            {
                source: 'local actual component with synthetic client; no live recharge',
                results,
                matchedPlanScroll: 'passed at 390×600',
                repeatVerificationFailure: 'passed',
                codeRejectionFeedback: 'passed at 1440px and 390px',
                clipboardFallback: 'passed at 390px',
            },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results) + '\n');
} finally {
    await browser.close();
}
