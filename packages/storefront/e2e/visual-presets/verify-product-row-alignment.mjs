import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(packageRoot, '../../tmp/product-row-price-alignment-20261010');
const baseUrl = process.env.STOREFRONT_VISUAL_BASE_URL || 'http://127.0.0.1:5310';
const cases = ['classic', 'neo-minimalist'].flatMap(skin =>
    [320, 390, 768, 1280].flatMap(width => ['zh', 'en'].map(lang => ({ skin, width, lang }))),
);
const results = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
    for (const sample of cases) {
        const page = await browser.newPage({ viewport: { width: sample.width, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(
            `${baseUrl}/e2e/visual-presets/product-row.html?skin=${sample.skin}&lang=${sample.lang}`,
        );
        await expect(page.locator('[data-sample="0"] .product-row')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect
            .poll(() =>
                page
                    .locator('.product-row-image img')
                    .evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)),
            )
            .toBe(true);
        const geometry = await page.locator('.product-row').evaluateAll(rows =>
            rows.map(row => {
                const bounds = selector => {
                    const rect = row.querySelector(selector).getBoundingClientRect();
                    return {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        right: rect.right,
                        bottom: rect.bottom,
                    };
                };
                const price = row.querySelector('.product-row-price');
                return {
                    compact: row.classList.contains('is-compact'),
                    image: bounds('.product-row-image'),
                    content: bounds('.product-row-content'),
                    top: bounds('.product-row-top'),
                    price: bounds('.product-row-price'),
                    priceOverflow: price.scrollWidth - price.clientWidth,
                    priceText: price.textContent,
                    fit: getComputedStyle(row.querySelector('.product-row-image img')).objectFit,
                };
            }),
        );
        assert.equal(errors.length, 0, errors.join('\n'));
        for (const [index, row] of geometry.entries()) {
            const horizontal = sample.width < 1024 || row.compact;
            assert.ok(Math.abs(row.image.width - row.image.height) < 1, 'Keep the existing square image');
            assert.equal(row.fit, 'contain', 'Show the complete product image');
            assert.ok(row.priceOverflow <= 1, `Complete price: ${row.priceText}`);
            if (horizontal) {
                assert.ok(row.price.x >= row.image.right + 11, 'The price must stay right of the image');
                assert.ok(
                    Math.abs(row.content.y - row.image.y) < 1,
                    'Right copy must align to the image top',
                );
                assert.ok(
                    row.price.right <= row.content.right + 1,
                    'Price must remain inside the right column',
                );
                // Normal, quote and sold-out rows align fully; extra metadata stays in the right column.
                if ([0, 3, 4, 5].includes(index)) {
                    assert.ok(
                        Math.abs(row.content.bottom - row.image.bottom) < 1,
                        'Normal row must align to the image bottom',
                    );
                }
            } else {
                assert.ok(row.content.y >= row.image.bottom, 'Preserve the existing desktop vertical card');
            }
        }
        const gridCard = await page
            .locator('.product-card')
            .first()
            .evaluate(card => {
                const media = card.querySelector('.product-card-media').getBoundingClientRect();
                const price = card.querySelector('.product-card-price').getBoundingClientRect();
                return { mediaBottom: media.bottom, priceTop: price.y };
            });
        assert.ok(gridCard.priceTop >= gridCard.mediaBottom, 'Keep the independent grid card layout');
        assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            'No horizontal overflow',
        );
        if (sample.skin === 'classic' && sample.width === 390 && sample.lang === 'zh') {
            await page
                .locator('[data-sample="0"]')
                .screenshot({ path: path.join(output, 'after-normal-390.png') });
        }
        results.push({ ...sample, geometry });
        await page.close();
    }
    await writeFile(path.join(output, 'verified-geometry.json'), JSON.stringify(results, null, 2));
    process.stdout.write(`Product row alignment: ${results.length} browser cases passed.\n`);
} finally {
    await browser.close();
}
