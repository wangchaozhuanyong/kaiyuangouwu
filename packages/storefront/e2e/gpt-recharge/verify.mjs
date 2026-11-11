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
        await page.goto(`${origin}/e2e/gpt-recharge/?skin=${skin}`);
        await page.getByText('ChatGPT自助充值', { exact: true }).waitFor();
        await page.locator('#gpt-code').waitFor();
        const planResult = page.locator('.gpt-recharge-code-section .gpt-recharge-summary dd');
        await expect(planResult).toHaveText('验码后自动显示');
        await expect(page.getByRole('button', { name: /^(Plus|Pro100|Pro200|Pro500)$/ })).toHaveCount(0);
        const codeBounds = await page.locator('#gpt-code').boundingBox();
        const planBounds = await planResult.boundingBox();
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
        for (const [code, plan] of [
            ['DEMO-100', 'Pro100'],
            ['DEMO-200', 'Pro200'],
        ]) {
            await page.locator('#gpt-code').fill(code);
            await expect(planResult).toHaveText('验码后自动显示');
            await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
            await expect(planResult).toHaveText(plan);
        }
        await page.locator('#gpt-code').fill('INVALID');
        await expect(planResult).toHaveText('验码后自动显示');
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await expect(page.locator('#gpt-verify-error')).toBeVisible();
        await expect(planResult).toHaveText('验码后自动显示');
        await page.getByRole('button', { name: '填入演示资料' }).click();
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await expect(planResult).toHaveText('Plus');
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
    const repeatPage = await browser.newPage({ viewport: { width: 390, height: 1100 } });
    await repeatPage.goto(`${origin}/e2e/gpt-recharge/?error=verify-repeat`);
    await repeatPage.locator('#gpt-code').waitFor();
    await repeatPage.getByRole('button', { name: '填入演示资料' }).click();
    const verifyCode = repeatPage.getByRole('button', { name: '验证兑换码', exact: true });
    const submit = repeatPage.getByRole('button', { name: '充值提交', exact: true });
    const confirmation = repeatPage.getByRole('checkbox');
    const verifiedPlan = repeatPage.locator('.gpt-recharge-code-section .gpt-recharge-summary dd');
    await verifyCode.click();
    await expect(verifiedPlan).toHaveText('Plus');
    await confirmation.check();
    await expect(submit).toBeEnabled();
    await verifyCode.click();
    await expect(repeatPage.locator('#gpt-verify-error')).toBeVisible();
    await expect(verifiedPlan).toHaveText('验码后自动显示');
    await expect(confirmation).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await repeatPage.close();
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1100 } });
        await page.goto(`${origin}/e2e/gpt-recharge/?error=verify-code-rejected`);
        const code = page.locator('#gpt-code');
        await code.fill('DEMO-PLUS');
        await page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        await expect(page.locator('#gpt-code-error')).toHaveText(
            '该兑换码无法在本商城使用，请核对兑换码后重试。',
        );
        await expect(code).toBeFocused();
        await expect(page.getByRole('button', { name: '充值提交', exact: true })).toBeDisabled();
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
            throw new Error(`Code rejection feedback overflow at ${width}`);
        await page.close();
    }
    await writeFile(
        path.join(output, 'browser-result.json'),
        JSON.stringify(
            {
                source: 'local actual component with synthetic client; no live recharge',
                results,
                repeatVerificationFailure: 'passed',
                codeRejectionFeedback: 'passed at 1440px and 390px',
            },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results) + '\n');
} finally {
    await browser.close();
}
