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
    // CSS can initially expose a 12px results box, then its real mobile height.
    // Do not release the reserve based on that unstyled intermediate geometry.
    await p.goto('http://reserve.test/zh/category');
    await p.evaluate(() => {
        history.replaceState({ __TSR_key: 'e' }, '');
        const list = document.querySelector('.category-results');
        list.style.height = '0px';
        list.style.maxHeight = '0px';
        const row = list.firstElementChild;
        row.style.height = '1200px';
        row.style.minHeight = '1200px';
    });
    await p.evaluate(source);
    await p.evaluate(() => {
        const list = document.querySelector('.category-results');
        list.style.height = '616px';
        list.style.maxHeight = '616px';
        list.firstElementChild.style.height = '128px';
        list.firstElementChild.style.minHeight = '128px';
    });
    await p.waitForTimeout(100);
    const styled = await p.locator('.category-results').evaluate(element => element.scrollTop);
    await fs.writeFile(q + '/styled-transition.json', JSON.stringify({ styled }));
    assert.equal(styled, 320, 'Styles arriving before React must not invalidate the restored position');
    await p.evaluate(() => document.dispatchEvent(new Event('pointerdown')));
} finally {
    await browser.close();
}
