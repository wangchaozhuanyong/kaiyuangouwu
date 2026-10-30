import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const q = process.env.SCROLL_RESERVE_OUTPUT ?? 'docs/local-validation/scroll-reserve';
const html = await fs.readFile('packages/storefront/index.html', 'utf8');
const source = html.match(/<script id="storefront-document-continuity">([\s\S]*?)<\/script>/)[1];
const css =
    (await fs.readFile('packages/storefront/src/styles.css', 'utf8')) +
    (await fs.readFile('packages/storefront/src/styles/home-showcase.css', 'utf8'));
await fs.mkdir(q, { recursive: true });
const browser = await chromium.launch();
try {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p.route('**/*', r =>
        r.fulfill({
            contentType: 'text/html',
            body:
                '<html><head><style>' +
                css +
                '</style><style>' +
                'body{height:844px}.category-results{height:616px;max-height:616px;width:300px}' +
                '.partial{height:128px;min-height:128px;flex-shrink:0}</style></head>' +
                '<body><section class="category-results" data-scroll-restoration-id="category-results">' +
                '<div class="partial">Partial content</div></section></body></html>',
        }),
    );
    await p.goto('http://reserve.test/zh/category');
    await p.evaluate(() => {
        history.replaceState({ __TSR_key: 'e' }, '');
        sessionStorage.setItem(
            'tsr-scroll-restoration-v1_3',
            JSON.stringify({
                e: { '[data-scroll-restoration-id="category-results"]': { scrollY: 320, scrollX: 0 } },
            }),
        );
    });
    await p.evaluate(source);
    await p.waitForTimeout(100);
    const state = await p.evaluate(() => {
        const e = document.querySelector('.category-results');
        return {
            top: e.scrollTop,
            height: e.scrollHeight,
            client: e.clientHeight,
            flex: getComputedStyle(e, '::after').flexShrink,
        };
    });
    await fs.writeFile(q + '/result.json', JSON.stringify(state, null, 2));
    process.stdout.write(JSON.stringify(state) + '\n');
    assert.equal(state.top, 320, 'Temporary scroll extent must survive vertical flex layout');
    await p.evaluate(() => document.dispatchEvent(new Event('pointerdown')));
    assert.equal(
        await p.locator('.category-results').evaluate(e => e.scrollHeight - e.clientHeight),
        0,
        'User input releases the extent',
    );
} finally {
    await browser.close();
}
