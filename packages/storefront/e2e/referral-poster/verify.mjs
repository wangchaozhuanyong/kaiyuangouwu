import { chromium, devices, expect, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { createServer } from 'vite';

const frontendRoot = fileURLToPath(new URL('../..', import.meta.url));
const output = path.join(frontendRoot, 'artifacts/readiness/referral-poster-browser');
const origin = 'http://127.0.0.1:5304';
const shareUrl = `${origin}/register?ref=ABCD2345&source=POSTER`;

async function verifyQr(download) {
    const imagePath = await download.path();
    assert.ok(imagePath, 'Browser did not save the poster');
    const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1920);
    const qr = QRCode.create(shareUrl, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    let mismatches = 0;
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            const x = Math.floor(106 + ((col + 4.5) * 276) / (count + 8));
            const y = Math.floor(1183 + ((row + 4.5) * 276) / (count + 8));
            const offset = (y * info.width + x) * info.channels;
            const dark = data[offset] < 120 && data[offset + 1] < 120;
            if (dark !== Boolean(qr.modules.get(row, col))) mismatches++;
        }
    }
    assert.equal(mismatches, 0, `Poster QR differs from its invitation URL at ${mismatches} modules`);
    return { width: info.width, height: info.height, qrModules: count, mismatches };
}

const frontend = await createServer({
    root: frontendRoot,
    server: { host: '127.0.0.1', port: 5304, strictPort: true },
});
await mkdir(output, { recursive: true });
await frontend.listen();
const results = [];
try {
    for (const [name, engine, options, preset] of [
        ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }, 'modern-oriental'],
        ['mobile', webkit, { ...devices['iPhone 13'] }, 'modern-oriental'],
        ['desktop-dark', chromium, { viewport: { width: 1440, height: 1000 } }, 'neo-minimalist'],
    ]) {
        const browser = await engine.launch({ headless: true });
        try {
            const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${origin}/e2e/referral-poster/index.html?preset=${preset}`);
            const dialog = page.getByRole('dialog', { name: '选择邀请海报' });
            await expect(dialog).toBeVisible();
            const preview = dialog.getByRole('img', { name: '品牌简约邀请海报预览' });
            await expect(preview).toBeVisible();
            await expect.poll(() => preview.evaluate(image => image.naturalWidth)).toBe(1080);
            const skinColors = await dialog.evaluate(element => {
                const root = getComputedStyle(document.documentElement);
                const save = getComputedStyle(element.querySelector('.referral-poster-save'));
                const selected = getComputedStyle(element.querySelector('[data-active="true"]'));
                return {
                    accent: root.getPropertyValue('--accent').trim(),
                    soft: root.getPropertyValue('--accent-soft').trim(),
                    save: save.backgroundColor,
                    selected: selected.backgroundColor,
                };
            });
            // CSS serialization can differ by browser; compare colors through a canvas in-page.
            const matchesSkin = await dialog.evaluate(element => {
                const root = getComputedStyle(document.documentElement);
                const color = value => {
                    const canvas = document.createElement('canvas');
                    const canvasContext = canvas.getContext('2d');
                    canvasContext.fillStyle = value.trim();
                    return canvasContext.fillStyle;
                };
                return {
                    save:
                        color(
                            getComputedStyle(element.querySelector('.referral-poster-save')).backgroundColor,
                        ) === color(root.getPropertyValue('--accent')),
                    selected:
                        color(
                            getComputedStyle(element.querySelector('[data-active="true"]')).backgroundColor,
                        ) === color(root.getPropertyValue('--accent-soft')),
                };
            });
            assert.deepEqual(matchesSkin, { save: true, selected: true }, JSON.stringify(skinColors));
            await page.screenshot({ path: path.join(output, `${name}-poster.png`) });
            const downloadPromise = page.waitForEvent('download');
            await dialog.getByRole('button', { name: '保存海报' }).click();
            const download = await downloadPromise;
            assert.equal(download.suggestedFilename(), '大马通-邀请海报-BRAND_MINIMAL.png');
            const first = await verifyQr(download);
            await expect(page.getByRole('status')).toContainText('邀请海报已保存');

            await dialog.locator('[data-template-id="PRODUCT_STORY"]').click();
            await expect(dialog.getByRole('img', { name: '商品故事邀请海报预览' })).toBeVisible();
            await expect
                .poll(() =>
                    dialog
                        .getByRole('img', { name: '商品故事邀请海报预览' })
                        .evaluate(image => image.naturalWidth),
                )
                .toBe(1080);
            const secondDownloadPromise = page.waitForEvent('download');
            await dialog.getByRole('button', { name: '保存海报' }).click();
            const secondDownload = await secondDownloadPromise;
            assert.equal(secondDownload.suggestedFilename(), '大马通-邀请海报-PRODUCT_STORY.png');
            const second = await verifyQr(secondDownload);
            assert.equal(errors.length, 0, errors.join('\n'));
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
            );
            assert.equal(overflow, false, `${name} has horizontal overflow`);
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            results.push({
                viewport: name,
                preset,
                default: first,
                alternate: second,
                noHorizontalOverflow: true,
            });
        } finally {
            await browser.close();
        }
    }
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
    await frontend.close();
}
