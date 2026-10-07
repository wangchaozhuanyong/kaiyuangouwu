import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.TRANSLATIONS_TEST_URL ?? 'http://127.0.0.1:5346/e2e/translations/index.html';
const output = process.env.TRANSLATIONS_TEST_OUTPUT;
if (!output || !path.isAbsolute(output))
    throw new Error('Set an absolute project-owned TRANSLATIONS_TEST_OUTPUT');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const countWrites = name =>
    page.evaluate(name => window.translationFixture.operations.filter(o => o.name === name).length, name);
const open = async () => {
    await page.goto(base);
    await expect(page.getByRole('button', { name: '筛选待人工复核', exact: true })).toContainText('1 项');
};
const review = () => page.getByRole('button', { name: '查看／复核', exact: true }).first();
const dialog = () => page.getByRole('dialog');
try {
    await open();
    await page.getByRole('button', { name: '筛选待人工复核', exact: true }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await review().click();
    await expect(dialog()).toContainText('当前中文内容');
    await expect(dialog()).toContainText('Reviewed English');
    await expect(dialog().getByRole('link', { name: '去原页面编辑' })).toHaveAttribute(
        'href',
        '/storefront/decoration?blockId=1&field=title&language=en',
    );
    await page.screenshot({ path: path.join(output, 'review-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog()).toHaveCount(0);
    await expect(review()).toBeFocused();
    checks.push('STALE count/filter, current text, real editor URL, Escape and focus return');

    await review().click();
    await dialog().getByRole('link', { name: '去原页面编辑' }).click();
    await expect(page).toHaveURL(/storefront\/decoration\?blockId=1/);
    const titleField = page.locator('[data-translation-field="title"]');
    await expect(titleField).toHaveValue('Reviewed English');
    await expect(titleField).toBeFocused();
    await page.screenshot({ path: path.join(output, 'original-editor.png'), fullPage: true });
    await page.keyboard.press('Escape');
    checks.push('review link opens original block editor in English and focuses target field');
    await open();
    await review().click();
    await dialog().getByRole('button', { name: '确认已复核，保留锁定', exact: true }).click();
    await expect(dialog()).toContainText('复核已确认，人工锁定已保留');
    expect(await countWrites('NextAdminConfirmContentTranslationReview')).toBe(1);
    checks.push('one confirmation, unchanged English and manual lock retained');
    await dialog().getByRole('button', { name: '关闭', exact: true }).last().click();

    await open();
    await page.evaluate(() => {
        window.translationFixture.conflict = true;
    });
    await review().click();
    await dialog().getByRole('button', { name: '确认已复核，保留锁定', exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText('复核期间已变化');
    await expect(dialog().getByRole('button', { name: '确认已复核，保留锁定', exact: true })).toBeDisabled();
    checks.push('version conflict shown without automatic mutation replay');

    await open();
    await page.evaluate(() => {
        window.translationFixture.failReadback = true;
    });
    await review().click();
    await dialog().getByRole('button', { name: '确认已复核，保留锁定', exact: true }).click();
    await expect(page.getByText(/操作已完成，但最新记录读取失败/).first()).toBeVisible();
    expect(await countWrites('NextAdminConfirmContentTranslationReview')).toBe(1);
    checks.push('write success/read failure separated and write remains single');

    await open();
    await page.getByRole('button', { name: '补齐历史翻译', exact: true }).click();
    await dialog().getByRole('button', { name: '开始第一批', exact: true }).click();
    await expect(dialog()).toContainText('累计扫描 1 项');
    await dialog().getByRole('button', { name: '继续下一批', exact: true }).click();
    await expect(dialog()).toContainText('累计扫描 2 项');
    await expect(dialog()).toContainText('后台翻译可能仍在进行');
    expect(await countWrites('NextAdminBackfillContentTranslations')).toBe(2);
    checks.push('batch and cumulative counts; scan completion does not claim translation complete');

    await open();
    await page.evaluate(() => {
        window.translationFixture.stalled = true;
    });
    await page.getByRole('button', { name: '补齐历史翻译', exact: true }).click();
    await dialog().getByRole('button', { name: '开始第一批', exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText(/进展|前进|游标/);
    await expect(dialog().getByRole('button', { name: '开始第一批', exact: true })).toBeDisabled();
    checks.push('no-progress guard stops further batches without success notice');

    for (const width of [360, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await open();
        await review().click();
        await expect(dialog()).toContainText('Reviewed English');
        await expect(
            dialog().getByRole('button', { name: '确认已复核，保留锁定', exact: true }),
        ).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(output, 'review-' + width + '.png'), fullPage: true });
        await page.keyboard.press('Escape');
        await expect(dialog()).toHaveCount(0);
    }
    checks.push('five widths: visible action, no document overflow, modal released');
    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'result.json'),
        JSON.stringify(
            {
                mode: 'synthetic local actual React/Apollo',
                base,
                checks,
                errors,
                productionWrites: false,
                realDevice: false,
                passed: true,
            },
            null,
            2,
        ),
    );
    console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
} finally {
    await browser.close();
}
