import { chromium, devices, expect, webkit } from '@playwright/test';
import jsQR from 'jsqr';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.resolve(
    root,
    process.env.POSTER_VERIFY_OUTPUT ||
        '../../reports/poster-artwork-circle-20261013/frontend/product-browser',
);
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:5368';
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5368, strictPort: true } });
await server.listen();
const selectedDevice = process.env.POSTER_VERIFY_DEVICE;
const results = selectedDevice
    ? JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8')).filter(
          item => item.device !== selectedDevice,
      )
    : [];
try {
    for (const [device, engine, options, language, skin] of [
        ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }, 'zh', 'classic'],
        ['mobile', webkit, { ...devices['iPhone 13'] }, 'en', 'neo-minimalist'],
    ]) {
        if (selectedDevice && device !== selectedDevice) continue;
        const browser = await engine.launch();
        try {
            const page = await browser.newPage({ ...options, reducedMotion: 'reduce' });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            for (const style of ['minimal', 'sunburst', 'aurora', 'champagne', 'jade']) {
                if (process.env.POSTER_VERIFY_STYLE && style !== process.env.POSTER_VERIFY_STYLE) continue;
                const url = `${origin}/e2e/artwork-poster/product.html?style=${style}&language=${language}&skin=${skin}`;
                await page.goto(url);
                assert.equal(
                    await page.evaluate(() => document.documentElement.dataset.storefrontPreset),
                    skin,
                );
                const dialog = page.getByRole('dialog');
                const save = dialog.getByRole('button', {
                    name: language === 'zh' ? '保存海报图片' : 'Save poster',
                    exact: true,
                });
                await expect(save).toBeEnabled();
                const box = await dialog.boundingBox();
                const viewportHeight = await page.evaluate(() => innerHeight);
                assert.ok(
                    box.y >= 0 && box.y + box.height <= viewportHeight + 1,
                    'dialog must remain inside viewport',
                );
                const close = dialog.locator('.poster-close-btn');
                await expect(close).toBeVisible();
                assert.equal(
                    await dialog.evaluate(el => el.scrollWidth > el.clientWidth),
                    false,
                    'poster must not scroll horizontally',
                );
                const previewQr = dialog.locator('img.poster-qrcode');
                const qrSource = await previewQr.getAttribute('src');
                assert.ok(qrSource.startsWith('data:image/svg+xml;'));
                const downloadPromise = page.waitForEvent('download');
                await save.click();
                const download = await downloadPromise;
                const file = path.join(output, `${device}-${style}.png`);
                await download.saveAs(file);
                const metadata = await sharp(file).metadata();
                assert.equal(metadata.width, 1440);
                assert.equal(metadata.height, 2160);
                for (const width of [1440, 720]) {
                    const compressed = await sharp(file).resize({ width }).jpeg({ quality: 75 }).toBuffer();
                    const { data, info } = await sharp(compressed)
                        .ensureAlpha()
                        .raw()
                        .toBuffer({ resolveWithObject: true });
                    assert.equal(
                        jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data,
                        url,
                        `${device}/${style}/${width}`,
                    );
                }
                assert.equal(
                    await previewQr.getAttribute('src'),
                    qrSource,
                    'export must retain displayed QR source',
                );
                const closeBox = await close.boundingBox();
                assert.ok(
                    closeBox.y >= box.y && closeBox.y + closeBox.height <= box.y + box.height,
                    'close must remain visible after scrolling to save',
                );
                assert.equal(
                    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                    false,
                );
                if (style === 'jade')
                    await page.screenshot({ path: path.join(output, `${device}-dialog.png`) });
                results.push({
                    device,
                    language,
                    skin,
                    style,
                    width: 1440,
                    height: 2160,
                    decodedOriginalAndCompressed: true,
                });
            }
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog')).toHaveCount(0);
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
