import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('.', import.meta.url));
const source = fileURLToPath(new URL('./fixture.html', import.meta.url));
const report = JSON.parse(await readFile(`${output}browser-matrix.json`, 'utf8'));
const browser = await chromium.launch({ headless: true });
const fixed = [];
const errors = [];
try {
    for (const width of [320, 390, 768])
        for (const preset of ['classic', 'neo-minimalist'])
            for (const lang of ['zh', 'en'])
                for (const store of ['a', 'b']) {
                    const label = `${width}/${preset}/${lang}/${store}`;
                    const context = await browser.newContext({
                        viewport: { width, height: 844 },
                        hasTouch: true,
                        reducedMotion: 'reduce',
                    });
                    const page = await context.newPage();
                    page.on('pageerror', error => errors.push(error.message));
                    await page.goto(
                        `http://127.0.0.1:5296/@fs${source}?view=studio&skin=${preset}&lang=${lang}&store=${store}`,
                    );
                    await page.locator('.ai-studio-fixed-generate').waitFor();
                    await page.evaluate(() => {
                        document.documentElement.style.setProperty('--safe-bottom', '34px');
                        window.dispatchEvent(new Event('resize'));
                    });
                    await page.evaluate(
                        () =>
                            new Promise(resolve =>
                                requestAnimationFrame(() => requestAnimationFrame(resolve)),
                            ),
                    );
                    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
                    const geometry = await page.evaluate(() => {
                        const bar = document.querySelector('.ai-studio-fixed-generate');
                        const last = document.querySelector('.ai-studio-terms-row').closest('section');
                        return {
                            height: bar.getBoundingClientRect().height,
                            padding: parseFloat(
                                getComputedStyle(document.querySelector('.page')).paddingBottom,
                            ),
                            gap: bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom,
                        };
                    });
                    expect(geometry.height).toBe(110);
                    expect(geometry.padding).toBe(126);
                    expect(Math.abs(geometry.gap - 16)).toBeLessThanOrEqual(1);
                    report.cases.find(item => item.label === label && item.view === 'studio').safeArea =
                        geometry;
                    fixed.push(`${label}/studio/safe: lastContentGap`);
                    if (store === 'a' && lang === 'zh' && preset === 'classic')
                        await page.screenshot({
                            path: `${output}accepted-${width}-${preset}-${lang}-${store}-studio-bottom.png`,
                        });
                    await context.close();
                }
    const supportPage = await browser.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        reducedMotion: 'reduce',
    });
    await supportPage.goto(
        `http://127.0.0.1:5296/@fs${source}?view=support&skin=neo-minimalist&lang=zh&store=a`,
    );
    await supportPage.locator('.support-channel-row[data-channel="wechat"]').click();
    await supportPage.getByRole('dialog').waitFor();
    await supportPage.keyboard.press('Escape');
    await expect(supportPage.getByRole('dialog')).toHaveCount(0);
    await expect(supportPage.locator('.support-channel-row[data-channel="wechat"]')).toBeFocused();
    expect(await supportPage.evaluate(() => document.body.style.overflow !== 'hidden')).toBe(true);
    fixed.push('390/neo-minimalist/zh/a/support/close: focusReturned');
} catch (error) {
    errors.push(error.stack ?? String(error));
} finally {
    await browser.close();
    report.errors = report.errors.filter(error => !fixed.includes(error)).concat(errors);
    report.rechecked = {
        reason: 'Corrected final-content selector (old probe selected the fixed action bar); await real trigger focus restoration.',
        states: fixed.length,
    };
    await writeFile(`${output}browser-matrix.json`, JSON.stringify(report, null, 2));
    writeDiagnostic(
        JSON.stringify(
            { cases: report.cases.length, rechecked: fixed.length, errors: report.errors },
            null,
            2,
        ),
    );
}
if (report.errors.length) process.exitCode = 1;

function writeDiagnostic(...values) {
    process.stdout.write(
        values.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ') + '\n',
    );
}
