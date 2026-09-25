import { expect, test } from '@playwright/test';

import { fixtureData } from '../visual-presets/fixtures.mjs';

test('private evidence upload survives reopening and submits the visible attachment IDs', async ({
    page,
}, testInfo) => {
    test.skip(!process.env.COMPAT_BASE_URL, 'Runs only against the explicit local verification bundle');
    const errors: string[] = [];
    page.setDefaultTimeout(15_000);
    await page.addInitScript(() => localStorage.setItem('storefront-analytics-opt-out:v1', '1'));
    const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
        'base64',
    );
    let drafts: Array<Record<string, unknown>> = [];
    let submitted: Record<string, unknown> | undefined;
    let uploads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        if (url.pathname.startsWith('/after-sales/evidence/'))
            return route.fulfill({ contentType: 'image/png', body: tinyPng });
        if (url.pathname.includes('storefront-realtime')) return route.fulfill({ status: 204, body: '' });
        if (!url.pathname.includes('shop-api')) return route.continue();
        const body = route.request().postData() ?? '';
        const multipart = route.request().headers()['content-type']?.includes('multipart/form-data');
        const request = multipart ? { query: body, variables: {} } : JSON.parse(body || '{}');
        const data = fixtureData('modern-oriental', true, 'aftercare');
        if (request.query.includes('UploadAfterSalesEvidence')) {
            const item = {
                id: `evidence-${++uploads}`,
                createdAt: new Date().toISOString(),
                mimeType: 'image/png',
                byteSize: tinyPng.length,
                available: true,
                previewUrl: `/after-sales/evidence/local-test-${uploads}`,
                expiresAt: null,
            };
            drafts.push(item);
            data.uploadAfterSalesEvidence = item;
        }
        if (request.query.includes('RemoveMyAfterSalesEvidenceDraft')) {
            drafts = drafts.filter(item => item.id !== request.variables.id);
            data.removeMyAfterSalesEvidenceDraft = true;
        }
        if (request.query.includes('createAfterSalesRequest(')) {
            submitted = request.variables.input;
            data.createAfterSalesRequest = {
                ...data.myAfterSalesRequests[0],
                id: 'new-local-request',
                evidence: drafts,
            };
            drafts = [];
        }
        data.myAfterSalesEvidenceDrafts = drafts;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
    });
    await page.goto('/order-detail?id=order-1');
    await page.getByRole('button', { name: '申请售后', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '申请售后' });
    await expect(dialog.getByRole('button', { name: '添加图片' })).toBeEnabled();
    await dialog
        .locator('input[type="file"]')
        .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
    await expect(dialog.getByRole('button', { name: '移除凭证 1' })).toBeVisible();
    await expect(dialog.locator('.after-sales-evidence [data-safe-image]')).toHaveAttribute(
        'data-safe-image',
        'ready',
    );
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '申请售后', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '移除凭证 1' })).toBeVisible();
    await dialog
        .locator('input[type="file"]')
        .setInputFiles({ name: 'synthetic-2.png', mimeType: 'image/png', buffer: tinyPng });
    await expect(dialog.getByRole('button', { name: '移除凭证 2' })).toBeVisible();
    await dialog.getByRole('button', { name: '移除凭证 1' }).click();
    await expect(dialog.getByRole('button', { name: '移除凭证 2' })).toHaveCount(0);
    await dialog.getByRole('checkbox').first().check();
    await dialog.getByLabel('问题描述').fill('本地测试图片凭证，请勿执行真实退款。');
    await dialog.locator('.after-sales-evidence').scrollIntoViewIfNeeded();
    const geometry = await dialog.evaluate(element => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
        screen: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.page).toBeLessThanOrEqual(geometry.screen + 1);
    await page.screenshot({ path: testInfo.outputPath('evidence-uploader.png'), fullPage: true });
    await dialog.getByRole('button', { name: '提交申请' }).click();
    await expect(dialog).toHaveCount(0);
    expect(submitted?.evidenceIds).toEqual(['evidence-2']);
    expect(errors).toEqual([]);
});
