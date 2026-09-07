import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.IMAGE_UPLOAD_TEST_URL ?? 'http://127.0.0.1:5297/e2e/image-upload/index.html';
const output = process.env.IMAGE_UPLOAD_TEST_OUTPUT ?? path.resolve('e2e/image-upload/results');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('vendure-active-channel-token', 'fixture-store'));

const svgPreview = (label, color) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${color}"/><text x="120" y="128" text-anchor="middle" fill="white" font-size="24">${label}</text></svg>`)}`;
let uploadCount = 0;
await page.route('**/admin-api', async route => {
    uploadCount += 1;
    const assets =
        uploadCount === 1
            ? [
                  {
                      __typename: 'Asset',
                      id: 'main-asset',
                      name: '直传主图.png',
                      preview: svgPreview('MAIN', '#2563eb'),
                      source: '/assets/main.png',
                      type: 'IMAGE',
                      mimeType: 'image/png',
                  },
              ]
            : [
                  {
                      __typename: 'Asset',
                      id: 'detail-asset-1',
                      name: '详情图-1.png',
                      preview: svgPreview('DETAIL 1', '#7c3aed'),
                      source: '/assets/detail-1.png',
                      type: 'IMAGE',
                      mimeType: 'image/png',
                  },
                  {
                      __typename: 'Asset',
                      id: 'detail-asset-2',
                      name: '详情图-2.webp',
                      preview: svgPreview('DETAIL 2', '#059669'),
                      source: '/assets/detail-2.webp',
                      type: 'IMAGE',
                      mimeType: 'image/webp',
                  },
              ];
    await route.fulfill({ json: { data: { createAssets: assets } } });
});

try {
    await page.goto(base);
    await expect(page.getByRole('button', { name: '上传商品主图', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '上传商品详情图', exact: true })).toBeVisible();
    await page.locator('input[type="file"][aria-label="上传商品主图文件"]').setInputFiles({
        name: 'main.png',
        mimeType: 'image/png',
        buffer: Buffer.from('main-image'),
    });
    await expect(page.getByRole('img', { name: '商品主图预览' })).toBeVisible();
    await expect(page.getByText('Asset ID: main-asset')).toBeVisible();

    await page.locator('input[type="file"][aria-label="上传商品详情图文件"]').setInputFiles([
        { name: 'detail-1.png', mimeType: 'image/png', buffer: Buffer.from('detail-one') },
        { name: 'detail-2.webp', mimeType: 'image/webp', buffer: Buffer.from('detail-two') },
    ]);
    await expect(page.getByRole('img', { name: '详情图-1.png' })).toBeVisible();
    await expect(page.getByRole('img', { name: '详情图-2.webp' })).toBeVisible();
    await expect(page.getByRole('button', { name: '管理详情图 (2)' })).toBeVisible();
    await page.screenshot({ path: `${output}/product-images-desktop.png`, fullPage: true });

    await page.getByRole('button', { name: '管理详情图 (2)' }).click();
    const dialog = page.getByRole('dialog', { name: '管理商品详情图集' });
    await expect(dialog.getByRole('button', { name: '上传商品详情图', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '详情图-1.png' })).toBeVisible();
    await dialog.getByLabel('关闭', { exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '上传商品主图', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '上传商品详情图', exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/product-images-mobile.png`, fullPage: true });

    expect(errors).toEqual([]);
    console.log(`IMAGE_UPLOAD_BROWSER_OK uploads=${uploadCount} screenshots=${output}`);
} finally {
    await browser.close();
}
