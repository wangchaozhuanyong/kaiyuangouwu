import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storefront = fileURLToPath(new URL('../../', import.meta.url));
const project = path.resolve(storefront, '../..');
const output = path.resolve(
    project,
    process.env.BRAND_QA_OUTPUT ?? 'docs/local-validation/loading-continuity-20261013/brand',
);
assert.ok(output.startsWith(project + path.sep), 'Evidence must remain inside its project');
await mkdir(output, { recursive: true });
const server = await createServer({ root: storefront, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#17645b"/></svg>';

function geometry() {
    const result = {};
    for (const name of [
        'route-transition-mark',
        'brand-loading-name',
        'brand-loading-subtitle',
        'brand-loading-caption',
    ]) {
        const rect = document.querySelector(`.${name}`).getBoundingClientRect();
        result[name] = [rect.x, rect.y, rect.width, rect.height];
    }
    return result;
}

try {
    for (const width of [390, 1440])
        for (const skin of ['classic', 'neo-minimalist']) {
            const context = await browser.newContext({ viewport: { width, height: 900 } });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => {
                const host = new URL(route.request().url()).hostname;
                return host === '127.0.0.1' ? route.continue() : route.abort();
            });
            let release;
            const gate = new Promise(resolve => {
                release = resolve;
            });
            await page.route('**/brand-fixture.svg', async route => {
                await gate;
                await route.fulfill({ contentType: 'image/svg+xml', body: svg });
            });
            await page.route('**/failed-brand.svg', route => route.fulfill({ status: 404, body: '' }));
            await page.goto(`${origin}/e2e/brand-continuity/?skin=${skin}`);
            await page.waitForFunction(() => Boolean(window.brandFixture));
            const neutral = await page.evaluate(geometry);
            await page.evaluate(() =>
                window.brandFixture.set({
                    name: '当前示例店铺',
                    subtitle: 'Example store',
                    logo: '/brand-fixture.svg',
                }),
            );
            await expect(page.locator('.brand-loading-name')).toHaveText('当前示例店铺');
            const loading = await page.evaluate(geometry);
            assert.deepEqual(
                loading,
                neutral,
                'Confirming a one-line brand must not move its loading caption',
            );
            await page.screenshot({ path: path.join(output, `${skin}-${width}-logo-pending.png`) });
            release();
            await expect(page.locator('.route-transition-mark')).toHaveClass(/is-logo-ready/u);
            assert.deepEqual(
                await page.evaluate(geometry),
                loading,
                'Decoded logo changed the reserved geometry',
            );
            await page.evaluate(() =>
                window.brandFixture.set({
                    name: '当前示例店铺',
                    subtitle: 'Example store',
                    logo: '/failed-brand.svg',
                }),
            );
            await expect(page.locator('.brand-loading img')).toHaveCount(0);
            assert.deepEqual(
                await page.evaluate(geometry),
                loading,
                'Failed logo collapsed the reserved geometry',
            );
            await page.screenshot({ path: path.join(output, `${skin}-${width}-logo-failed.png`) });
            for (const [language, name] of [
                ['zh', '这是用于检查品牌长名称完整换行与文字放大后仍可阅读的示例商店'],
                ['en', 'An exceptionally long example storefront identity with readable complete wording'],
            ]) {
                await page.evaluate(brandLabel => {
                    window.brandFixture.set({
                        name: brandLabel,
                        subtitle: 'International example store',
                        logo: '',
                    });
                    document.documentElement.style.zoom = '2';
                }, name);
                await expect(page.locator('.brand-loading-name')).toHaveText(name);
                const layout = await page.evaluate(() => {
                    const nameElement = document.querySelector('.brand-loading-name');
                    const subtitle = document.querySelector('.brand-loading-subtitle');
                    return {
                        width: document.documentElement.clientWidth,
                        scrollWidth: document.documentElement.scrollWidth,
                        nameHeight: nameElement.clientHeight,
                        nameScrollHeight: nameElement.scrollHeight,
                        overlap:
                            nameElement.getBoundingClientRect().bottom > subtitle.getBoundingClientRect().top,
                        overflow: getComputedStyle(nameElement).overflow,
                        whiteSpace: getComputedStyle(name).whiteSpace,
                    };
                });
                assert.ok(
                    layout.scrollWidth <= layout.width,
                    '200% zoom introduces horizontal page overflow',
                );
                assert.ok(layout.nameScrollHeight <= layout.nameHeight, 'Brand name text is clipped');
                assert.equal(layout.overlap, false, 'Long brand name overlaps its subtitle');
                assert.equal(layout.whiteSpace, 'normal');
                await page.screenshot({
                    path: path.join(output, `${skin}-${width}-long-${language}-200.png`),
                    fullPage: true,
                });
            }
            checks.push({
                width,
                skin,
                neutral,
                loading,
                logoFailureStable: true,
                longNamesAt200Percent: true,
            });
            await context.close();
        }
    assert.deepEqual(errors, []);
    await writeFile(
        path.join(output, 'receipt.json'),
        JSON.stringify(
            {
                source: 'Real BrandLoadingIndicator + production styles, synthetic anonymous brands, localhost only',
                checks,
                errors,
            },
            null,
            2,
        ),
    );
    process.stdout.write(
        `Brand continuity: ${checks.length} viewport/skin combinations passed; pending, decoded, failed logo and long text at 200%.\n`,
    );
} catch (error) {
    await writeFile(
        path.join(output, 'failure.json'),
        JSON.stringify({ checks, errors, failure: String(error.stack ?? error) }, null, 2),
    );
    throw error;
} finally {
    await browser.close();
    await server.close();
}
