import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(
    new URL('../../../../docs/local-validation/shop-abuse-protection-20261017/', import.meta.url),
);
const origin = process.env.GPT_RECHARGE_PREVIEW_ORIGIN || 'http://127.0.0.1:5186';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const session = JSON.stringify({
    user: { id: 'synthetic', email: 'synthetic@example.test' },
    accessToken: 'synthetic-not-a-real-credential',
});
async function calls(page) {
    return Number(await page.locator('[data-demo-abuse-calls]').getAttribute('data-demo-abuse-calls'));
}
try {
    for (const width of [1440, 390, 320]) {
        for (const skin of ['classic', 'neo-minimalist']) {
            for (const language of ['zh', 'en']) {
                const page = await browser.newPage({ viewport: { width, height: 1100 } });
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.goto(
                    `${origin}/e2e/gpt-recharge/?presentation=1&abuse=1&skin=${skin}&language=${language}`,
                );
                await page.locator('#gpt-code').fill('DEMO-PLUS-001');
                await page.locator('#gpt-session').fill(session);
                const verify = page.getByRole('button', {
                    name: language === 'zh' ? '验证' : 'Verify',
                    exact: true,
                });
                await verify.click();
                const control = page.locator('.shop-abuse-challenge');
                await control.locator('img').waitFor();
                assert.equal(await calls(page), 1, 'A challenge response must not replay verification');
                await control.locator('input').fill('ZZZ234');
                await verify.click();
                await page.waitForFunction(
                    () =>
                        document
                            .querySelector('[data-demo-abuse-calls]')
                            ?.getAttribute('data-demo-abuse-calls') === '2',
                );
                await control.locator('img').waitFor();
                await control.locator('input').fill('ABC234');
                assert.equal(
                    await page.locator('#gpt-session').inputValue(),
                    session,
                    'Security refusal must retain the typed session',
                );
                assert.equal(
                    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                    false,
                );
                await page.screenshot({
                    path: path.join(output, `challenge-${width}-${skin}-${language}.png`),
                    fullPage: true,
                });
                await verify.click();
                await page
                    .getByText(language === 'zh' ? '已锁定 Plus' : 'Plan locked: Plus', { exact: true })
                    .waitFor();
                await page.getByRole('checkbox').check();
                const submit = page.getByRole('button', {
                    name: language === 'zh' ? '充值提交' : 'Submit recharge',
                    exact: true,
                });
                await submit.click();
                const submitControl = page.locator('.shop-abuse-challenge');
                await submitControl.locator('img').waitFor();
                assert.equal(await calls(page), 4, 'A recharge challenge must not replay a write');
                assert.equal(await page.locator('#gpt-session').inputValue(), session);
                assert.equal(await page.getByRole('checkbox').isChecked(), true);
                assert.equal(
                    await page.locator('.gpt-recharge-result').count(),
                    0,
                    'Preflight rejection must not render a task',
                );
                await submitControl.locator('input').fill('ABC234');
                await submitControl.locator('input').press('Enter');
                await page
                    .getByRole('heading', {
                        name: language === 'zh' ? '已受理，等待处理' : 'Accepted, waiting to process',
                        exact: true,
                    })
                    .waitFor();
                assert.equal(await calls(page), 5, 'Manual retry executes the write exactly once');
                assert.deepEqual(errors, []);
                results.push({
                    width,
                    skin,
                    language,
                    challenge: 'passed',
                    noReplay: true,
                    retainedSession: true,
                    overflow: false,
                });
                await page.close();
            }
        }
    }
    for (const mode of ['rate', 'unavailable']) {
        const page = await browser.newPage({ viewport: { width: 390, height: 1100 } });
        await page.goto(`${origin}/e2e/gpt-recharge/?presentation=1&abuse=${mode}`);
        await page.locator('#gpt-code').fill('DEMO-PLUS-001');
        const button = page.getByRole('button', { name: '验证', exact: true });
        await button.click();
        await page.locator('.shop-abuse-challenge').waitFor();
        assert.equal(
            await page.locator('.shop-abuse-challenge img').count(),
            0,
            'Rate limits must not require an image',
        );
        if (mode === 'rate') await page.waitForTimeout(1100);
        await button.click();
        await page.getByText('已锁定 Plus', { exact: true }).waitFor();
        assert.equal(await calls(page), 2);
        results.push({ mode, manualRecovery: 'passed', noForcedChallenge: true });
        await page.close();
    }
    await writeFile(
        path.join(output, 'browser-result.json'),
        JSON.stringify(
            {
                source: 'actual recharge component with synthetic local security client; no real recharge',
                results,
            },
            null,
            2,
        ),
    );
    process.stdout.write(`Passed ${results.length} browser scenarios\n`);
} finally {
    await browser.close();
}
