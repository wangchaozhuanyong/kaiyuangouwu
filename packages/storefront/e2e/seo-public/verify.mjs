import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureKinds, fixtureLanguages, fixtureStores, syntheticPage } from './fixtures.mjs';
import { startSeoFixtureServer } from './preview-server.mjs';

const output = fileURLToPath(new URL('./artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await startSeoFixtureServer();
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
try {
    for (const [index, store] of fixtureStores.entries())
        for (const languageCode of fixtureLanguages)
            for (const kind of fixtureKinds) {
                const host = `${index === 0 ? '127.0.0.1' : 'localhost'}:${server.port}`;
                const origin = `http://${host}`;
                const fixture = syntheticPage(store, languageCode, kind, { host, origin });
                const id = `${store}-${languageCode}-${kind}`;
                const response = await fetch(origin + fixture.route);
                assert.equal(response.status, 200);
                const html = await response.text();
                await writeFile(`${output}/${id}.html`, html);
                assert.ok(html.includes('data-public-rendered="1"'));
                assert.ok(html.includes(fixture.seo.canonical.replaceAll('&', '&amp;')));
                assert.ok(
                    html.includes(
                        kind === 'article' ? fixture.publicContent.body : fixture.config.description,
                    ),
                );
                assert.ok(!html.includes(fixtureStores.find(other => other !== store)));
                const context = await browser.newContext({
                    viewport: { width: 390, height: 844 },
                    locale: languageCode === 'zh_Hans' ? 'en-US' : 'zh-CN',
                });
                const page = await context.newPage();
                const caseErrors = [];
                let documentNavigations = 0;
                page.on('request', request => {
                    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
                        documentNavigations++;
                });
                page.on('console', message => {
                    if (message.type() === 'error') caseErrors.push(message.text());
                });
                page.on('pageerror', error => caseErrors.push(error.message));
                await page.route('**/*', route =>
                    ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
                        ? route.continue()
                        : route.abort(),
                );
                try {
                    await page.goto(origin + fixture.route);
                    // This boundary exists only in the normal runtime, after actual hydrateRoot has handed over.
                    await expect(page.locator('[data-page-readiness=ready]')).toBeVisible({
                        timeout: 20_000,
                    });
                    await expect(page.locator('#storefront-boot-loading')).toHaveCount(0);
                    await expect(page.locator('html')).toHaveAttribute(
                        'lang',
                        languageCode === 'zh_Hans' ? 'zh-CN' : 'en',
                    );
                    await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
                        'href',
                        fixture.seo.canonical,
                    );
                    await expect(page.locator('meta[name=robots]')).toHaveAttribute(
                        'content',
                        fixture.seo.robots,
                    );
                    await expect(page.locator('link[rel=alternate][hreflang]')).toHaveCount(3);
                    await expect(page).toHaveTitle(fixture.seo.title);
                    const text = await page.locator('#storefront-content').innerText();
                    assert.ok(
                        !text.includes(fixtureStores.find(other => other !== store)),
                        `${id}: cross-store body`,
                    );
                    if (kind === 'product')
                        await expect(page.locator('h1').first()).toContainText(fixture.product.name);
                    if (kind === 'article') {
                        await expect(page.locator('h1').first()).toContainText(fixture.publicContent.title);
                        await expect(page.locator('#storefront-content')).toContainText(
                            fixture.publicContent.body,
                        );
                    }
                    if (kind === 'catalog')
                        await expect(page.locator('#storefront-content')).toContainText(
                            fixture.catalog.items[0].name,
                        );
                    await page.screenshot({ path: `${output}/${id}.png`, fullPage: false });
                    // Follow an actual visible public link to prove the regular router remains interactive.
                    const link = page
                        .locator(
                            `a[href="/${languageCode === 'zh_Hans' ? 'zh' : 'en'}/product?id=${store}-product-1"]`,
                        )
                        .first();
                    if (kind === 'home' || kind === 'article') {
                        await link.click();
                        await expect(page).toHaveURL(
                            origin +
                                `/${languageCode === 'zh_Hans' ? 'zh' : 'en'}/product?id=${store}-product-1`,
                        );
                        await expect(page.locator('h1').first()).toContainText(fixture.products[0].name);
                        if (kind === 'home')
                            assert.equal(
                                documentNavigations,
                                1,
                                `${id}: client navigation must not reload the document`,
                            );
                    }
                    if (caseErrors.length) errors.push({ id, errors: caseErrors });
                    checks.push({
                        id,
                        serverRendered: true,
                        runtimeReady: true,
                        canonical: fixture.seo.canonical,
                        errors: caseErrors,
                    });
                } catch (error) {
                    errors.push({ id, failure: error.message, errors: caseErrors });
                    await page.screenshot({ path: `${output}/${id}-failure.png`, fullPage: false });
                    throw error;
                } finally {
                    await context.close();
                }
            }
    await writeFile(
        `${output}/report.json`,
        JSON.stringify({ synthetic: true, checks, errors, requests: server.requests }, null, 2),
    );
    assert.deepEqual(errors, [], 'Browser console/page errors (including hydration) must be empty');
    process.stdout.write(
        JSON.stringify({ synthetic: true, checks: checks.length, browserErrors: errors.length, output }) +
            '\n',
    );
} finally {
    await writeFile(
        `${output}/report.json`,
        JSON.stringify({ synthetic: true, checks, errors, requests: server.requests }, null, 2),
    );
    await browser.close();
    await server.close();
}
