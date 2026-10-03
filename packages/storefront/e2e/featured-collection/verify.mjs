import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const output = path.join(root, 'artifacts/featured-collection-template-20261003');
const baseUrl = process.env.COLLECTION_PREVIEW_URL ?? 'http://127.0.0.1:5327';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
try {
    for (const preset of ['classic', 'neo-minimalist']) {
        for (const width of [1440, 390]) {
            const page = await browser.newPage({
                viewport: { width, height: 1000 },
                locale: 'zh-CN',
                reducedMotion: 'reduce',
            });
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => localStorage.setItem('storefront-analytics-opt-out:v1', '1'));
            await page.route('**/*', route =>
                new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort(),
            );
            let clientGeometry;
            for (const surface of ['client', 'admin']) {
                await page.goto(
                    `${baseUrl}/${surface === 'admin' ? 'admin-preview' : ''}?preset=${preset}&count=6`,
                );
                const scope = surface === 'admin' ? page.frameLocator('iframe') : page;
                const section = scope.locator('.featured-collection-section');
                const collection = section.locator('.featured-collection-mosaic');
                await expect(collection).toHaveAttribute('data-product-count', '6');
                await expect(collection.locator('.is-mosaic')).toHaveCount(1);
                await expect(collection.locator('.is-gallery')).toHaveCount(5);
                await expect(section.locator('.featured-collection-grid')).toHaveCount(0);
                await expect(collection.locator('.product-card-price')).toHaveCount(6);
                await expect(collection.locator('.product-card-stock')).toHaveCount(2);
                await collection.locator('img').last().scrollIntoViewIfNeeded();
                await expect
                    .poll(() =>
                        collection
                            .locator('img')
                            .evaluateAll(images =>
                                images.every(
                                    img =>
                                        img.complete &&
                                        img.naturalWidth > 0 &&
                                        getComputedStyle(img).objectFit === 'contain',
                                ),
                            ),
                    )
                    .toBe(true);
                const geometry = await collection.evaluate(element => {
                    const bounds = element.getBoundingClientRect();
                    return {
                        width: bounds.width,
                        height: bounds.height,
                        cards: [...element.querySelectorAll('.product-card')].map(card => {
                            const box = card.getBoundingClientRect();
                            const media = card.querySelector('.product-card-media').getBoundingClientRect();
                            return {
                                x: box.x - bounds.x,
                                y: box.y - bounds.y,
                                width: box.width,
                                height: box.height,
                                mediaWidth: media.width,
                                mediaHeight: media.height,
                            };
                        }),
                        background: getComputedStyle(element).backgroundColor,
                        gap: getComputedStyle(element).gap,
                    };
                });
                assert.ok(geometry.cards[0].mediaWidth > geometry.cards[1].mediaWidth * 1.5);
                for (const card of geometry.cards) {
                    assert.ok(
                        Math.abs(card.mediaWidth - card.mediaHeight) < 1,
                        'Stable square media with uncropped subjects',
                    );
                    assert.ok(card.mediaWidth > 100, 'Supporting artwork stays readable on mobile');
                    assert.ok(card.x >= 0 && card.x + card.width <= geometry.width + 1);
                }
                assert.ok(
                    width < 768
                        ? geometry.cards[1].y > geometry.cards[0].y
                        : geometry.cards[1].x > geometry.cards[0].x,
                );
                const links = await collection
                    .locator('a')
                    .evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute('href')));
                assert.deepEqual(
                    links.map(href => new URL(href, locationUrl()).searchParams.get('id')),
                    Array.from({ length: 6 }, (_, index) => `local-collection-product-${index + 1}`),
                );
                await section.screenshot({ path: path.join(output, `${surface}-${preset}-${width}.png`) });
                if (surface === 'client') clientGeometry = geometry;
                else
                    assert.deepEqual(
                        geometry,
                        clientGeometry,
                        'Compiled Admin preview shares the exact collection layout',
                    );
                results.push({ surface, preset, width, count: 6, geometry, links, status: 'PASS' });
            }
            if (preset === 'classic') {
                for (const count of [0, 1, 2, 3, 4, 5, 7]) {
                    await page.goto(`${baseUrl}/?preset=${preset}&count=${count}`);
                    const section = page.locator('.featured-collection-section');
                    await expect(section.locator('.product-card')).toHaveCount(count);
                    if (count === 0)
                        await expect(section.locator('.featured-collection-empty')).toBeVisible();
                    else {
                        await expect(section.locator('.featured-collection-mosaic')).toHaveAttribute(
                            'data-product-count',
                            String(count),
                        );
                        const firstMedia = await section.locator('.product-card-media').first().boundingBox();
                        assert.ok(firstMedia.width > 100 && firstMedia.height > 100);
                    }
                    assert.ok(
                        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
                    );
                    results.push({ surface: 'client', preset, width, count, status: 'PASS' });
                }
                await page.goto(`${baseUrl}/?preset=classic&count=6`);
                await page.locator('.featured-collection-mosaic .product-card-detail-link').first().click();
                await expect(page).toHaveURL(/\/product\?id=local-collection-product-1/u);
                await page.goto(`${baseUrl}/?preset=classic&count=6`);
                await page.locator('.featured-collection-mosaic .product-card-detail-link').last().click();
                await expect(page).toHaveURL(/\/product\?id=local-collection-product-6/u);
                await page.goto(`${baseUrl}/?preset=classic&count=6`);
                await page.locator('.featured-collection-action').click();
                await expect(page).toHaveURL(/\/category/u);
                results.push({
                    surface: 'client',
                    preset,
                    width,
                    check: 'Lead, supporting product and collection navigation',
                    status: 'PASS',
                });
            }
            await page.close();
        }
    }
    assert.deepEqual(errors, []);
} finally {
    await browser.close();
    await writeFile(
        path.join(output, 'browser-results.json'),
        JSON.stringify(
            {
                dataSource:
                    'Existing project artwork, synthetic product prices and stock; local compiled storefront and actual Admin srcdoc preview entry.',
                productionWrites: false,
                externalRequestsAllowed: false,
                results,
                errors,
            },
            null,
            2,
        ) + '\n',
    );
}
process.stdout.write(`Collection template browser acceptance: ${results.length} PASS; zero page errors.\n`);

function locationUrl() {
    return baseUrl;
}
