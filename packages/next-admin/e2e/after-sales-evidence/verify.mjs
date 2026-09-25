import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('../storefront/artifacts/readiness/admin-evidence-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
    await page.route('**/after-sales/evidence/**', route =>
        route.fulfill({
            contentType: 'image/svg+xml',
            body: [
                '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240">',
                '<rect width="360" height="240" fill="#dbe4e0"/>',
                '<rect x="80" y="35" width="200" height="165" rx="12" fill="#fffaf1"/>',
                '<path d="M110 80h140M110 110h140M110 140h85" stroke="#718681" stroke-width="6"/>',
                '</svg>',
            ].join(''),
        }),
    );
    await page.goto(
        process.env.ADMIN_EVIDENCE_TEST_URL || 'http://127.0.0.1:53317/e2e/after-sales-evidence/index.html',
    );
    await page.getByRole('button', { name: '审核详情', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '售后工单详情' });
    await expect(dialog.getByRole('img', { name: '买家凭证 1' })).toBeVisible();
    await expect(dialog.getByRole('img', { name: '买家凭证 2' })).toBeVisible();
    await expect(dialog.getByText('凭证已过保留期或已移除', { exact: true })).toBeVisible();
    const link = dialog.getByRole('link', { name: '查看买家凭证 1' });
    const before = await link.getAttribute('href');
    await dialog.getByRole('button', { name: '刷新图片', exact: true }).click();
    await expect(link).not.toHaveAttribute('href', before);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(dialog.getByRole('img', { name: '买家凭证 1' })).toHaveCSS('object-fit', 'contain');
    await expect
        .poll(() =>
            dialog
                .getByRole('img', { name: '买家凭证 1' })
                .evaluate(image => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
    await page.screenshot({ path: path.join(output, 'admin-private-evidence.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'result.json'),
        JSON.stringify(
            {
                passed: true,
                scope: 'synthetic Admin UI with formal component; no production access',
                refreshUpdatesLinks: true,
                privateImagesVisible: true,
                expiredEvidenceVisible: true,
                errors,
            },
            null,
            2,
        ),
    );
} catch (error) {
    await writeFile(
        path.join(output, 'failure.json'),
        JSON.stringify(
            { errors, message: String(error), visibleText: await page.locator('body').innerText() },
            null,
            2,
        ),
    );
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    throw error;
} finally {
    await browser.close();
}
