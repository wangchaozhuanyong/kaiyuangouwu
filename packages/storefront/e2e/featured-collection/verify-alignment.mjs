import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const output = path.join(root, '.runtime/featured-collection-alignment/browser');
await mkdir(output, { recursive: true });
const server = await startSeoFixtureServer(0, {
    readOnly: true,
    transformPage(page, { url }) {
        const count = Number(url.searchParams.get('count') ?? 6);
        const copy = url.searchParams.get('copy') ?? 'normal';
        page.visualPreset.presetId = url.searchParams.get('preset') ?? 'classic';
        page.products = page.products.slice(0, count);
        page.products.forEach((product, index) => {
            const label =
                page.scope.languageCode === 'zh_Hans'
                    ? `订阅方案${index + 1} · 1个月`
                    : `Plan ${index + 1} · 1 month`;
            product.name =
                (copy === 'lead' && index === 0) || (copy === 'supporting' && index === 1)
                    ? `${label} / `.repeat(8)
                    : label;
        });
        page.content.blocks = [
            {
                id: 'alignment-collection',
                code: 'alignment-collection',
                type: 'FEATURED_COLLECTION',
                enabled: true,
                position: 0,
                startsAt: null,
                endsAt: null,
                imageUrl: null,
                backgroundColor: null,
                textColor: null,
                title: '精选集合 · 本地合成数据',
                subtitle: '',
                body: '',
                ctaLabel: '',
                targetType: 'NONE',
                targetValue: null,
                items: [],
                settings: {
                    displayCount: count,
                    selectedProductIds: page.products.map(product => product.id),
                },
            },
        ];
    },
});
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];

async function measure(page, width, label) {
    const collection = page.locator('.featured-collection-mosaic');
    await expect(collection.locator('.product-card')).toHaveCount(
        Number(new URL(page.url()).searchParams.get('count') ?? 6),
    );
    await expect(page.locator('html')).toHaveAttribute('data-storefront-app-owned', '');
    const geometry = () =>
        collection.evaluate(element => {
            const cards = [...element.querySelectorAll('.product-card')];
            const media = cards.map(card => {
                const box = card.querySelector('.product-card-media').getBoundingClientRect();
                return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
            });
            return {
                topError: Math.min(...media.slice(1).map(box => box.top)) - media[0].top,
                bottomError: Math.max(...media.slice(1).map(box => box.bottom)) - media[0].bottom,
                media,
                overflow: document.documentElement.scrollWidth > window.innerWidth,
            };
        });
    if (width >= 768) {
        await expect
            .poll(async () => Math.abs((await geometry()).bottomError), { message: label })
            .toBeLessThan(0.5);
        assert.ok(Math.abs((await geometry()).topError) < 0.5, `${label}: image top edges`);
    } else {
        await expect
            .poll(
                async () => {
                    const { media } = await geometry();
                    return media[1].top > media[0].bottom;
                },
                { message: `${label}: stacked phone layout` },
            )
            .toBe(true);
    }
    const result = await geometry();
    assert.equal(result.overflow, false, `${label}: no horizontal overflow`);
    for (const image of result.media)
        assert.ok(Math.abs(image.width - image.height) < 0.5, `${label}: square images`);
    if (width < 768)
        assert.ok(result.media[1].top > result.media[0].bottom, `${label}: stacked phone layout`);
    assert.ok(
        await collection
            .locator('img')
            .evaluateAll(images => images.every(img => getComputedStyle(img).objectFit === 'contain')),
    );
    results.push({ label, width, ...result, status: 'PASS' });
}

try {
    for (const preset of ['classic', 'neo-minimalist']) {
        for (const language of ['zh', 'en']) {
            const page = await browser.newPage({
                viewport: { width: 1440, height: 1000 },
                reducedMotion: 'reduce',
            });
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => localStorage.setItem('storefront-analytics-opt-out:v1', '1'));
            await page.route('**/*', route =>
                new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
            );
            const url = (count = 6, copy = 'normal') =>
                `${origin}/${language}/?preset=${preset}&count=${count}&copy=${copy}`;
            await page.goto(url());
            await measure(page, 1440, `${preset}/${language}/SSR`);
            await page.reload();
            await measure(page, 1440, `${preset}/${language}/refresh`);
            // Exercise the same mounted component across desktop, tablet and phone breakpoints.
            for (const width of [1024, 768, 390, 1440]) {
                await page.setViewportSize({ width, height: 1000 });
                await measure(page, width, `${preset}/${language}/resize-${width}`);
            }
            for (const copy of ['lead', 'supporting']) {
                await page.goto(url(6, copy));
                await measure(page, 1440, `${preset}/${language}/long-${copy}`);
            }
            for (const count of [3, 4, 5, 7]) {
                await page.goto(url(count));
                await measure(page, 1440, `${preset}/${language}/count-${count}`);
            }
            await page.goto(url());
            await measure(page, 1440, `${preset}/${language}/return`);
            await page
                .locator('.featured-collection-section')
                .screenshot({ path: path.join(output, `${preset}-${language}.png`) });
            await page.close();
        }
    }
    assert.deepEqual(errors, []);
} finally {
    await browser.close();
    await server.close();
    await writeFile(
        path.join(output, 'results.json'),
        JSON.stringify(
            {
                dataSource:
                    'Synthetic anonymous local products; actual SSR renderer and browser application.',
                productionWrites: false,
                results,
                errors,
            },
            null,
            2,
        ) + '\n',
    );
}
process.stdout.write(`Featured collection alignment: ${results.length} PASS, no page errors.`);
