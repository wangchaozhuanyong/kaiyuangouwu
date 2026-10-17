import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.env.GPT_RECHARGE_VALIDATION_OUTPUT_DIR
    ? path.resolve(process.env.GPT_RECHARGE_VALIDATION_OUTPUT_DIR)
    : fileURLToPath(
          new URL('../../../../docs/local-validation/gpt-recharge-feedback-20261017/', import.meta.url),
      );
const origin = process.env.GPT_RECHARGE_PREVIEW_ORIGIN || 'http://127.0.0.1:5186';
const scope = process.env.GPT_RECHARGE_FEEDBACK_SCOPE || 'all';
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
async function assertFocused(page, selector) {
    await page.waitForFunction(value => document.activeElement?.matches(value), selector);
}
async function assertInViewport(page, selector) {
    await page.waitForFunction(value => {
        const bounds = document.querySelector(value)?.getBoundingClientRect();
        return bounds && bounds.top >= 0 && bounds.bottom <= innerHeight;
    }, selector);
}
async function assertNoOverflow(page) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
async function assertChallengeErrorField(page) {
    await page.waitForFunction(() => {
        const input = document.querySelector('.shop-abuse-challenge input[aria-invalid="true"]');
        const shell = input?.closest('.auth-input-shell');
        const feedback = document.querySelector('.shop-abuse-challenge-error');
        if (!shell || !feedback) return false;
        const style = getComputedStyle(shell);
        return (
            parseFloat(style.borderTopWidth) > 0 && style.borderTopColor === getComputedStyle(feedback).color
        );
    });
}
try {
    if (scope !== 'short-code') {
        for (const width of [1440, 390, 320]) {
            for (const skin of ['classic', 'neo-minimalist']) {
                for (const language of ['zh', 'en']) {
                    const page = await browser.newPage({ viewport: { width, height: 1100 } });
                    const errors = [];
                    page.on('pageerror', error => errors.push(error.message));
                    await page.goto(
                        `${origin}/e2e/gpt-recharge/?presentation=1&abuse=1&skin=${skin}&language=${language}`,
                    );
                    const verify = page.getByRole('button', {
                        name: language === 'zh' ? '验证兑换码' : 'Verify code',
                        exact: true,
                    });
                    assert.equal(await page.locator('.shop-abuse-challenge').count(), 0);
                    await verify.click();
                    await page.locator('#gpt-code-error').waitFor();
                    await assertFocused(page, '#gpt-code');
                    assert.equal(await calls(page), 0, 'Empty input must fail locally');
                    assert.equal(await page.locator('#gpt-code').getAttribute('aria-invalid'), 'true');
                    await page.locator('#gpt-code').fill('DEMO-PLUS-001');
                    await page.locator('#gpt-session').fill(session);
                    await verify.click();
                    const control = page.locator('.shop-abuse-challenge');
                    await control.locator('img').waitFor();
                    await assertFocused(page, '.shop-abuse-challenge input');
                    await assertInViewport(page, '.shop-abuse-challenge input');
                    assert.equal(
                        await control
                            .locator('p')
                            .last()
                            .textContent()
                            .then(value => value.includes(language === 'zh' ? '验证兑换码' : 'Verify code')),
                        true,
                    );
                    assert.equal(
                        await control.evaluate(element => {
                            const button = element.closest('form').querySelector('button[type="submit"]');
                            return (
                                element.compareDocumentPosition(button) === Node.DOCUMENT_POSITION_FOLLOWING
                            );
                        }),
                        true,
                        'The single verification action must follow the challenge',
                    );
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
                    assert.equal(
                        await control.locator('.shop-abuse-challenge-error').getAttribute('role'),
                        'alert',
                    );
                    await assertChallengeErrorField(page);
                    await control.locator('input').fill('ABC234');
                    assert.equal(
                        await page.locator('#gpt-session').inputValue(),
                        session,
                        'Security refusal must retain the typed session',
                    );
                    await assertNoOverflow(page);
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
            const button = page.getByRole('button', { name: '验证兑换码', exact: true });
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
        for (const width of [1440, 390]) {
            for (const skin of ['classic', 'neo-minimalist']) {
                for (const language of ['zh', 'en']) {
                    const zh = language === 'zh';
                    for (const mode of ['verify', 'query', 'submit-rejected', 'submit-unknown']) {
                        const page = await browser.newPage({ viewport: { width, height: 1100 } });
                        const errors = [];
                        page.on('pageerror', error => errors.push(error.message));
                        await page.goto(
                            `${origin}/e2e/gpt-recharge/?presentation=1&error=${mode}&skin=${skin}&language=${language}`,
                        );
                        const verify = page.getByRole('button', {
                            name: zh ? '验证兑换码' : 'Verify code',
                            exact: true,
                        });
                        const submit = page.getByRole('button', {
                            name: zh ? '充值提交' : 'Submit recharge',
                            exact: true,
                        });
                        await page.locator('#gpt-submit-help').waitFor();
                        assert.equal(await submit.isDisabled(), true);
                        let feedbackSelector;
                        if (mode === 'query') {
                            await page
                                .getByRole('button', { name: zh ? '兑换码查询' : 'Code lookup', exact: true })
                                .click();
                            await page.locator('#gpt-query').fill('DEMO-PLUS-001');
                            await page
                                .getByRole('button', {
                                    name: zh ? '查询充值结果' : 'Look up result',
                                    exact: true,
                                })
                                .click();
                            feedbackSelector = '#gpt-query-error';
                            await page.locator(feedbackSelector).waitFor();
                            assert.equal(
                                await page
                                    .locator(`${feedbackSelector}`)
                                    .evaluate(element => Boolean(element.closest('.gpt-recharge-query'))),
                                true,
                            );
                        } else {
                            await page.locator('#gpt-code').fill('DEMO-PLUS-001');
                            await verify.click();
                            if (mode === 'verify') {
                                feedbackSelector = '#gpt-verify-error';
                                await page.locator(feedbackSelector).waitFor();
                                assert.notEqual(
                                    await page.locator('#gpt-code').getAttribute('aria-invalid'),
                                    'true',
                                );
                                assert.equal(
                                    await page
                                        .locator(feedbackSelector)
                                        .evaluate(element =>
                                            Boolean(element.closest('.gpt-recharge-code-section')),
                                        ),
                                    true,
                                );
                                assert.equal(await page.locator('.shop-abuse-challenge').count(), 0);
                            } else {
                                await page
                                    .getByText(zh ? '已锁定 Plus' : 'Plan locked: Plus', { exact: true })
                                    .waitFor();
                                await page.locator('#gpt-session').fill(session);
                                await page.getByRole('checkbox').check();
                                await submit.click();
                                if (mode === 'submit-rejected') {
                                    feedbackSelector = '#gpt-submit-error';
                                    await page.locator(feedbackSelector).waitFor();
                                    assert.equal(
                                        await page
                                            .locator(feedbackSelector)
                                            .evaluate(element =>
                                                Boolean(element.closest('.gpt-recharge-account-section')),
                                            ),
                                        true,
                                    );
                                    assert.equal(await page.locator('#gpt-session').inputValue(), '');
                                    assert.equal(await page.getByRole('checkbox').isChecked(), false);
                                    assert.equal(await submit.isDisabled(), true);
                                    assert.equal(
                                        await page
                                            .locator('[data-demo-submit-calls]')
                                            .getAttribute('data-demo-submit-calls'),
                                        '1',
                                    );
                                } else {
                                    await page
                                        .getByRole('heading', {
                                            name: zh ? '正在确认提交结果' : 'Confirming your submission',
                                            exact: true,
                                        })
                                        .waitFor();
                                    assert.equal(
                                        await submit.count(),
                                        0,
                                        'Unknown submissions must not offer another recharge',
                                    );
                                    assert.equal(
                                        await page
                                            .locator('[data-demo-submit-calls]')
                                            .getAttribute('data-demo-submit-calls'),
                                        '1',
                                    );
                                    await page
                                        .getByRole('button', {
                                            name: zh ? '查询原任务' : 'Look up original task',
                                            exact: true,
                                        })
                                        .click();
                                    assert.equal(
                                        await page.locator('#gpt-query').inputValue(),
                                        'DEMO-PLUS-001',
                                    );
                                    await page
                                        .getByRole('button', {
                                            name: zh ? '自助充值' : 'Recharge',
                                            exact: true,
                                        })
                                        .click();
                                    assert.equal(await submit.count(), 0);
                                    assert.equal(
                                        await page
                                            .locator('[data-demo-submit-calls]')
                                            .getAttribute('data-demo-submit-calls'),
                                        '1',
                                    );
                                }
                            }
                        }
                        if (feedbackSelector) {
                            await assertFocused(page, feedbackSelector);
                            await assertInViewport(page, feedbackSelector);
                            assert.equal(await page.locator(feedbackSelector).getAttribute('role'), 'alert');
                        }
                        assert.equal(
                            await page
                                .locator('body')
                                .textContent()
                                .then(value => value.includes('Synthetic private')),
                            false,
                        );
                        await assertNoOverflow(page);
                        await page.screenshot({
                            path: path.join(output, `${mode}-${width}-${skin}-${language}.png`),
                            fullPage: true,
                        });
                        assert.deepEqual(errors, []);
                        results.push({
                            mode,
                            width,
                            skin,
                            language,
                            localFeedback: 'passed',
                            noReplay: true,
                            overflow: false,
                        });
                        await page.close();
                    }
                }
            }
        }
    }
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
                const verify = page.getByRole('button', {
                    name: language === 'zh' ? '验证兑换码' : 'Verify code',
                    exact: true,
                });
                await verify.click();
                const control = page.locator('.shop-abuse-challenge');
                await control.locator('img').waitFor();
                await control.locator('input').fill('ABC');
                await verify.click();
                await control.locator('.shop-abuse-challenge-error').waitFor();
                assert.equal(
                    await control.locator('.shop-abuse-challenge-error').getAttribute('role'),
                    'alert',
                );
                assert.equal(await calls(page), 1, 'A short answer must fail locally without replay');
                await assertFocused(page, '.shop-abuse-challenge input');
                await assertInViewport(page, '.shop-abuse-challenge input');
                assert.equal(await control.locator('input').getAttribute('aria-invalid'), 'true');
                await assertChallengeErrorField(page);
                assert.equal(await verify.evaluate(button => button.form.noValidate), true);
                await assertNoOverflow(page);
                await page.screenshot({
                    path: path.join(output, `short-code-${width}-${skin}-${language}.png`),
                    fullPage: true,
                });
                assert.deepEqual(errors, []);
                results.push({
                    mode: 'short-code',
                    width,
                    skin,
                    language,
                    inlineValidation: 'passed',
                    noReplay: true,
                    overflow: false,
                });
                await page.close();
            }
        }
    }
    await writeFile(
        path.join(
            output,
            scope === 'short-code' ? 'short-code-browser-result.json' : 'feedback-browser-result.json',
        ),
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
