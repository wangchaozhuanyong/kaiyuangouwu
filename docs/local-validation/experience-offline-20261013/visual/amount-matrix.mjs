import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('.', import.meta.url));
const source = fileURLToPath(new URL('./fixture.html', import.meta.url));
const browser = await chromium.launch({ headless: true });
const report = {
    environment: 'Actual ReferralPage; synthetic MYR balances, 320px; no production writes.',
    cases: [],
    errors: [],
};
try {
    for (const skin of ['classic', 'neo-minimalist'])
        for (const language of ['zh', 'en']) {
            const page = await browser.newPage({
                viewport: { width: 320, height: 844 },
                hasTouch: true,
                reducedMotion: 'reduce',
            });
            page.on('pageerror', error => report.errors.push(error.message));
            for (const [name, available, pending, expected] of [
                ['normal', 12500, 2990, ['125', '29.9']],
                ['large', 123456789, 999999999999, ['1,234,567.89', '9,999,999,999.99']],
            ]) {
                await page.goto(
                    `http://127.0.0.1:5296/@fs${source}?view=referral&skin=${skin}&lang=${language}&available=${available}&pending=${pending}`,
                );
                await page.locator('.referral-balance-value').first().waitFor();
                const metrics = await page.evaluate(() =>
                    [...document.querySelectorAll('.referral-balance-value')].map(element => {
                        const range = document.createRange();
                        range.selectNodeContents(element);
                        return {
                            text: element.textContent,
                            lines: range.getClientRects().length,
                            width: element.clientWidth,
                            scrollWidth: element.scrollWidth,
                            whiteSpace: getComputedStyle(element).whiteSpace,
                            overflowWrap: getComputedStyle(element).overflowWrap,
                        };
                    }),
                );
                expect(metrics.map(item => item.text)).toEqual(expected);
                expect(
                    metrics.every(
                        item =>
                            item.lines === 1 &&
                            item.whiteSpace === 'nowrap' &&
                            item.overflowWrap === 'normal',
                    ),
                ).toBe(true);
                expect(metrics.every(item => item.scrollWidth <= item.width + 1)).toBe(true);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
                    true,
                );
                await page
                    .locator('.referral-overview')
                    .screenshot({ path: `${output}amount-320-${skin}-${language}-${name}.png` });
                report.cases.push({ skin, language, name, available, pending, metrics });
            }
            await page.close();
        }
} catch (error) {
    report.errors.push(error.stack ?? String(error));
} finally {
    await browser.close();
    await writeFile(`${output}amount-matrix.json`, JSON.stringify(report, null, 2));
    process.stdout.write(
        JSON.stringify({ cases: report.cases.length, errors: report.errors }, null, 2) + '\n',
    );
}
if (report.errors.length) process.exitCode = 1;
