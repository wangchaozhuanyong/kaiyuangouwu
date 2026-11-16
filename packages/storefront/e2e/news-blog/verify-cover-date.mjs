import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../../../../backups/blog-cover-date-20261116/browser/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const [skin, origin] of [
        ['classic', process.env.BLOG_CLASSIC_ORIGIN || 'http://127.0.0.1:5191'],
        ['neo-minimalist', process.env.BLOG_NEO_ORIGIN || 'http://127.0.0.1:5192'],
    ]) {
        for (const width of [1440, 1024, 768, 390, 320]) {
            const page = await browser.newPage({
                viewport: { width, height: 1000 },
                reducedMotion: 'reduce',
            });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${origin}/zh/blog`);
            await page.waitForFunction(() =>
                document.documentElement.hasAttribute('data-storefront-app-owned'),
            );
            const cover = page.locator('.blog-feature .blog-cover');
            await expect(cover).toBeVisible();
            await expect(page.locator('.blog-feature-cover-title')).toHaveText('热门 Skill');
            const bounds = await cover.boundingBox();
            const ratio = width >= 1024 ? 4 / 3 : 16 / 9;
            assert(Math.abs(bounds.width / bounds.height - ratio) < 0.02);
            assert(bounds.height > 120);
            const art = await page.locator('.blog-feature-art').boundingBox();
            assert(art.width > 100 && art.height > 60);
            const regular = await page.locator('.blog-card .blog-cover').first().boundingBox();
            assert(Math.abs(regular.height - 120) <= 1);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.screenshot({
                path: fileURLToPath(new URL(`${skin}-${width}.png`, output)),
                fullPage: true,
            });
            results.push({ skin, width, cover: bounds, art, overflow: false, consoleErrors: errors });
            assert.deepEqual(errors, []);

            if (width === 1440 || width === 390) {
                await page
                    .getByRole('navigation', { name: '文章分类' })
                    .getByRole('link', { name: 'ChatGPT', exact: true })
                    .click();
                await expect(page.locator('.blog-feature')).toHaveCount(0);
                await expect(page.locator('.blog-card').first()).toContainText('消息日期：');
                const dates = await page
                    .locator('.blog-card .blog-meta time')
                    .evaluateAll(nodes => nodes.map(node => node.dateTime));
                assert(dates.length > 1);
                assert.deepEqual(
                    dates.map(Date.parse),
                    dates.map(Date.parse).sort((a, b) => b - a),
                );
                assert.equal(dates.at(-1), '2026-09-30T00:00:00Z');
                await page.locator('.blog-card h2 a[href="/zh/blog/local-qa-1"]').click();
                const metadata = page.locator('.blog-article-header .blog-meta');
                await expect(metadata).toContainText('消息日期：2026年9月30日');
                await expect(metadata).toContainText('本站发布：2026年11月3日');
                assert(
                    Math.abs(
                        (await page.locator('.blog-article-cover .blog-theme').boundingBox()).height - 120,
                    ) <= 1,
                );
                assert.deepEqual(errors, []);
                results.push({ skin, width, scenario: 'category-source-order-and-detail-dates', dates });
            }
            await page.close();
        }
        const noJs = await browser.newPage({
            javaScriptEnabled: false,
            viewport: { width: 1440, height: 1000 },
        });
        await noJs.goto(`${origin}/zh/blog`);
        await expect(noJs.locator('.blog-feature-cover-title')).toHaveText('热门 Skill');
        const noJsBounds = await noJs.locator('.blog-feature .blog-cover').boundingBox();
        const hydrated = results.find(result => result.skin === skin && result.width === 1440).cover;
        assert(Math.abs(noJsBounds.height - hydrated.height) < 1);
        assert(Math.abs(noJsBounds.width - hydrated.width) < 1);
        results.push({ skin, scenario: 'no-javascript-cover-geometry', cover: noJsBounds });
        await noJs.close();
    }
    await writeFile(
        new URL('results.json', output),
        JSON.stringify(
            { source: 'Production storefront artifacts with synthetic blog data', results },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} catch (error) {
    await writeFile(new URL('failure.txt', output), String(error.stack || error));
    throw error;
} finally {
    await browser.close();
}
