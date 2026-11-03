import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../../../reports/environment-monitor-20261101/', import.meta.url));
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const html = await readFile(`${dist}index.html`, 'utf8');
const asset = html.match(/<link\b[^>]*\bhref=["']\/assets\/([^"']+\.css)["']/iu)?.[1];
assert.ok(asset, 'Built main stylesheet exists');
const css = await readFile(`${dist}assets/${asset}`, 'utf8');
const before = JSON.parse(await readFile(`${output}auth-css-before.json`, 'utf8'));
const browser = await chromium.launch();
const after = [];
try {
    for (const { width, height } of before) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.route('**/*', route => route.abort());
        await page.setContent(
            '<div class="storefront-app"><div class="auth-page auth-page-login"><div class="auth-h' +
                'ero-benefits"></div><div class="auth-hero-services"></div><div class="auth-hero-benef' +
                'it-copy"><strong>登录说明</strong></div><div class="auth-hero-message-managed"><div class' +
                '="auth-hero-kicker"></div><div class="auth-hero-tags"></div></div></div></div>',
        );
        await page.addStyleTag({ content: css });
        after.push({
            width,
            height,
            styles: await page.locator('.auth-page div,.auth-page strong').evaluateAll(nodes =>
                nodes.map(node => {
                    const style = getComputedStyle(node);
                    return {
                        className: node.className,
                        display: style.display,
                        fontSize: style.fontSize,
                        lineHeight: style.lineHeight,
                        fontWeight: style.fontWeight,
                        color: style.color,
                        textAlign: style.textAlign,
                        width: style.width,
                        height: style.height,
                    };
                }),
            ),
        });
        await page.close();
    }
    await writeFile(`${output}auth-css-after.json`, JSON.stringify(after, null, 2) + '\n');
    assert.deepEqual(after, before, 'Equivalent CSS cleanup preserves all sampled computed styles');
    process.stdout.write('Shared CSS equivalence passed: 390×700, 390×900, 1440×900' + '\n');
} finally {
    await browser.close();
}
