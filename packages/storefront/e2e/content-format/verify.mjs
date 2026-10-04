import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../visual-presets/fixtures.mjs';

import { warrantyText } from './warranty-text.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = fileURLToPath(new URL('../../artifacts/content-format/', import.meta.url));
const baseUrl = process.env.CONTENT_FORMAT_BASE_URL || 'http://127.0.0.1:5197';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

async function pageFor(width, description = warrantyText) {
    const page = await browser.newPage({
        viewport: { width, height: 960 },
        locale: 'zh-CN',
        reducedMotion: 'reduce',
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const data = structuredClone(fixtureData('classic', false));
    data.product.name = 'ChatGPT 订阅代充服务';
    data.product.description = description;
    data.products.items = [data.product];
    data.storefrontCatalog.items = [data.product];
    data.storefrontContent[0].body = '内容说明第一行\n\n内容说明第二段';
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        if (url.pathname.includes('shop-api'))
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
        if (url.pathname.includes('/storefront-realtime')) return route.fulfill({ status: 204, body: '' });
        return route.continue();
    });
    return { page, errors };
}

async function checkLines(locator, value) {
    return locator.evaluate((element, text) => {
        const bounds = (phrase, end = false) => {
            const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            while (walk.nextNode()) {
                const node = walk.currentNode;
                const index = node.textContent.indexOf(phrase);
                if (index < 0) continue;
                const range = document.createRange();
                const offset = index + (end ? phrase.length - 1 : 0);
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                return range.getBoundingClientRect().top;
            }
            throw new Error(`Missing text: ${phrase}`);
        };
        const lines = text.split('\n');
        let previousEnd = null;
        let emptyLines = 0;
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
        for (const line of lines) {
            if (!line) {
                emptyLines++;
                continue;
            }
            const top = bounds(line);
            if (previousEnd !== null && top - previousEnd < lineHeight * (emptyLines + 1) - 1) {
                throw new Error(`Lost explicit break before: ${line}`);
            }
            previousEnd = bounds(line, true);
            emptyLines = 0;
        }
        return {
            lines: lines.length,
            lineHeight,
            height: element.getBoundingClientRect().height,
            whiteSpace: getComputedStyle(element).whiteSpace,
        };
    }, value);
}

try {
    for (const width of [1440, 390]) {
        const { page, errors } = await pageFor(width);
        await page.goto(`${baseUrl}/product?id=product-1`);
        const content = page.locator('.detail-rich-text');
        await expect(content).toBeVisible();
        expect(await content.innerText()).toBe(warrantyText);
        const geometry = await checkLines(content, warrantyText);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
            true,
        );
        expect(errors).toEqual([]);
        await content.screenshot({ path: `${output}/warranty-${width}.png` });
        results.push({ case: 'full-warranty-plaintext', width, status: 'PASS', ...geometry });
        await page.close();

        const rich =
            '<p>第一段</p><p></p><p>第二段<br>段内换行</p><ol start="5"><li>第五条</li><li>第六条</li></ol><ul><li>子项</li></ul><script>window.unsafeContent=true</script>';
        const richPage = await pageFor(width, rich);
        await richPage.page.goto(`${baseUrl}/product?id=product-1`);
        const richContent = richPage.page.locator('.detail-rich-text');
        await expect(richContent).toBeVisible();
        await expect(richContent.locator('ol')).toHaveCSS('list-style-type', 'decimal');
        await expect(richContent.locator('ul')).toHaveCSS('list-style-type', 'disc');
        expect(await richContent.locator('ol').getAttribute('start')).toBe('5');
        expect(
            await richContent
                .locator('p')
                .nth(1)
                .evaluate(el => el.getBoundingClientRect().height),
        ).toBeGreaterThan(0);
        await checkLines(richContent.locator('p').nth(2), '第二段\n段内换行');
        expect(await richPage.page.evaluate(() => window.unsafeContent)).toBeUndefined();
        expect(richPage.errors).toEqual([]);
        results.push({ case: 'legacy-rich-paragraphs-and-lists', width, status: 'PASS' });
        await richPage.page.close();

        const home = await pageFor(width);
        await home.page.goto(baseUrl);
        const heroCopy = home.page.locator('.hero-rich-desc, .proto-flagship-desc');
        await expect(heroCopy).toBeVisible();
        const body = '内容说明第一行\n\n内容说明第二段';
        expect(await heroCopy.textContent()).toBe(body);
        expect(await heroCopy.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
        await checkLines(heroCopy, body);
        expect(home.errors).toEqual([]);
        results.push({ case: 'managed-hero-body', width, status: 'PASS' });
        await home.page.close();
    }
    const receipt = {
        status: 'PASS',
        dataSource:
            'Local production bundles with synthetic API fixtures and the user-provided warranty text. No production reads or writes.',
        previewDirectory: `${root}packages/storefront/dist`,
        worktree: root,
        branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        changedFiles: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
            .trim()
            .split('\n'),
        results,
    };
    await writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ status: receipt.status, cases: results.length, output }) + '\n');
} finally {
    await browser.close();
}
