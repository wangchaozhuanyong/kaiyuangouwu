import { chromium, devices, expect, webkit } from '@playwright/test';
import jsQR from 'jsqr';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.resolve(
    root,
    process.env.POSTER_VERIFY_OUTPUT || '../../reports/poster-artwork-circle-20261013/browser',
);
await mkdir(output, { recursive: true });
const port = 5367;
const origin = `http://127.0.0.1:${port}`;
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
const results = [];
const selectedCases = process.env.POSTER_VERIFY_CASES?.split(',');
try {
    for (const [device, engine, options] of [
        ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }],
        ['mobile', webkit, { ...devices['iPhone 13'] }],
    ]) {
        const browser = await engine.launch();
        try {
            const page = await browser.newPage({ ...options, reducedMotion: 'reduce' });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${origin}/e2e/artwork-poster/index.html`);
            const dialog = page.getByRole('dialog');
            for (const [id, name] of [
                ['minimal', '极简圆环'],
                ['sunburst', '星芒圆盘'],
                ['aurora', '极光轨道'],
                ['champagne', '香槟徽章'],
                ['jade', '翡翠涟漪'],
                ['square', '正方形海报'],
            ]) {
                if (selectedCases && !selectedCases.includes(`${device}:${id}`)) continue;
                await dialog.locator(`[data-template-id="${id}"]`).click();
                const preview = dialog.getByRole('img', { name: `${name}邀请海报预览` });
                await expect(preview).toBeVisible();
                await expect.poll(() => preview.evaluate(img => img.naturalWidth)).toBe(1080);
                const pending = page.waitForEvent('download');
                await dialog.getByRole('button', { name: '保存海报', exact: true }).click();
                const download = await pending;
                const file = path.join(output, `${device}-${id}.png`);
                await download.saveAs(file);
                const meta = await sharp(file).metadata();
                assert.equal(meta.height, id === 'square' ? 1080 : 1920);
                for (const width of [1080, 540]) {
                    const buffer = await sharp(file).resize({ width }).jpeg({ quality: 75 }).toBuffer();
                    const { data, info } = await sharp(buffer)
                        .ensureAlpha()
                        .raw()
                        .toBuffer({ resolveWithObject: true });
                    assert.equal(
                        jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data,
                        `${origin}/register?ref=ABCD2345&source=POSTER`,
                        `${device}/${id}/${width}`,
                    );
                }
                const { data: cornerPixel } = await sharp(file)
                    .extract({ left: 10, top: 10, width: 1, height: 1 })
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                assert.deepEqual(
                    [...cornerPixel].slice(0, 3),
                    [220, 233, 227],
                    'artwork must not receive legacy overlay',
                );
                results.push({
                    device,
                    id,
                    width: meta.width,
                    height: meta.height,
                    decodedOriginalAndCompressed: true,
                });
            }
            await page.screenshot({ path: path.join(output, `${device}-square.png`) });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await dialog.locator('[data-template-id="invalid"]').click();
            await expect(dialog.getByRole('alert')).toContainText('图片比例不符');
            await expect(dialog.getByRole('button', { name: '保存海报', exact: true })).toBeDisabled();
            await dialog.locator('[data-template-id="aurora"]').click();
            await expect(dialog.getByRole('img', { name: '极光轨道邀请海报预览' })).toBeVisible();
            await page.screenshot({ path: path.join(output, `${device}-portrait.png`) });
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            assert.deepEqual(errors, []);
        } finally {
            await browser.close();
        }
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    process.stdout.write(`${JSON.stringify(results)}\n`);
} finally {
    await server.close();
}
