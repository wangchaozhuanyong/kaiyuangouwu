import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(
    new URL('../../../../docs/local-validation/gpt-recharge-20261016/', import.meta.url),
);
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
        await page.goto(`http://127.0.0.1:5184/e2e/gpt-recharge/?skin=${skin}`);
        await page.getByText('ChatGPT自助充值', { exact: true }).waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `recharge-${width}-${skin}.png`), fullPage: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        if (overflow) throw new Error(`Horizontal overflow at ${width}/${skin}`);
        await page.getByRole('button', { name: '填入演示资料' }).click();
        await page.getByRole('button', { name: '验证', exact: true }).click();
        await page.getByText('已锁定 Plus').waitFor();
        if (!(await page.getByRole('button', { name: 'Pro200', exact: true }).isDisabled()))
            throw new Error('Plan is not locked');
        await page.locator('#gpt-session').fill('{');
        await page.getByText('JSON 格式不完整，请重新全选复制账号资料。').waitFor();
        if (await page.getByRole('button', { name: '充值提交', exact: true }).isEnabled())
            throw new Error('Invalid JSON can submit');
        await page.getByRole('button', { name: '填入演示资料' }).click();
        await page.getByRole('button', { name: '验证', exact: true }).click();
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
    await writeFile(
        path.join(output, 'browser-result.json'),
        JSON.stringify(
            { source: 'local actual component with synthetic client; no live recharge', results },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results) + '\n');
} finally {
    await browser.close();
}
