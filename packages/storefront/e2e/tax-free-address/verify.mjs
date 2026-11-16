import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = process.env.TAX_ADDRESS_EVIDENCE_DIR
    ? process.env.TAX_ADDRESS_EVIDENCE_DIR + '/'
    : fileURLToPath(new URL('../../../../outputs/tax-free-address-20261116/', import.meta.url));
await mkdir(output, { recursive: true });

const toolOrigin = 'https://address.moyaoai.com';
const dist = new URL('../../dist/.address-tool/', import.meta.url);
async function mountAddressFixture(context, loseResponse = false) {
    const fixture = { writes: 0, rejected: [] };
    let receipt;
    const types = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== toolOrigin) {
            if (url.origin === 'http://127.0.0.1:5189') return route.continue();
            fixture.rejected.push(url.origin);
            return route.abort();
        }
        const now = Date.now();
        if (url.pathname === '/api/address/status')
            return route.fulfill({
                json: {
                    serverNow: new Date(now).toISOString(),
                    nextAllowedAt: receipt?.nextAllowedAt ?? null,
                },
            });
        if (url.pathname === '/api/address/claim') {
            const requestOrigin = await route.request().headerValue('origin');
            if (requestOrigin !== toolOrigin) {
                fixture.rejected.push('unexpected claim origin: ' + requestOrigin);
                return route.fulfill({ status: 403 });
            }
            const { requestId } = route.request().postDataJSON();
            if (receipt?.requestId === requestId) return route.fulfill({ json: receipt });
            if (receipt) return route.fulfill({ status: 429, json: { code: 'TAX_ADDRESS_COOLDOWN' } });
            fixture.writes++;
            const stamp = new Date(now).toISOString();
            receipt = {
                requestId,
                serverNow: stamp,
                nextAllowedAt: new Date(now + 300000).toISOString(),
                address: {
                    id: 'fixture-1',
                    country: 'United States',
                    line1: '123 Example St',
                    city: 'Manchester',
                    state: 'New Hampshire',
                    postalCode: '03101',
                    status: 'used',
                    createdAt: stamp,
                    usedAt: stamp,
                },
            };
            return loseResponse ? route.abort() : route.fulfill({ json: receipt });
        }
        if (url.pathname === '/')
            return route.fulfill({
                body: await readFile(new URL('index.html', dist)),
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Security-Policy':
                        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'",
                    'Referrer-Policy': 'no-referrer',
                },
            });
        const asset = /^\/assets\/[A-Za-z0-9_-]+\.(js|css|svg)$/.exec(url.pathname);
        if (asset)
            return route.fulfill({
                contentType: types[asset[1]],
                body: await readFile(new URL(url.pathname.slice(1), dist)),
            });
        fixture.rejected.push(url.pathname);
        return route.fulfill({ status: 404, body: 'Not found' });
    });
    return fixture;
}
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const width of [390, 1440])
        for (const lang of ['zh', 'en']) {
            const context = await browser.newContext({
                viewport: { width, height: 960 },
                permissions: ['clipboard-read', 'clipboard-write'],
                reducedMotion: 'reduce',
            });
            const fixture = await mountAddressFixture(context);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(toolOrigin + '/?lang=' + lang);
            await expect(page.getByRole('button', { name: /返回上一页|Go back/ })).toHaveCount(0);
            const extract = page.getByRole('button', {
                name: lang === 'zh' ? '提取地址' : 'Get address',
                exact: true,
            });
            await expect(extract).toBeEnabled();
            await extract.click();
            const copy = page.getByRole('button', {
                name: lang === 'zh' ? '一键复制' : 'Copy address',
                exact: true,
            });
            await expect(copy).toBeVisible();
            await copy.click();
            const copied = await page.evaluate(() => navigator.clipboard.readText());
            assert.equal(
                copied,
                '国家（英语）：United States\n地址（英语）：123 Example St\n城市（英语）：Manchester\n州（英语）：New Hampshire\n邮编（英语）：03101',
            );
            await expect(
                page.getByRole('button', { name: lang === 'zh' ? /下次可提取/ : /Available in/ }),
            ).toBeDisabled();
            await page.reload();
            await expect(
                page.getByRole('button', { name: lang === 'zh' ? /下次可提取/ : /Available in/ }),
            ).toBeDisabled();
            await expect(
                page
                    .getByRole('region', { name: lang === 'zh' ? '本次提取' : 'Latest address', exact: true })
                    .getByText('123 Example St', { exact: true }),
            ).toBeVisible();
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
                true,
            );
            assert.equal(await page.locator('a, iframe, [src*="moyaoai.com"]').count(), 0);
            assert.equal(fixture.writes, 1);
            const screenshot = 'address-' + width + '-' + lang + '.png';
            await page.screenshot({ path: output + screenshot, fullPage: true });
            assert.deepEqual(errors, []);
            assert.deepEqual(fixture.rejected, []);
            results.push({ page: 'standalone', width, lang, screenshot, passed: true });
            await context.close();
        }
    {
        const context = await browser.newContext({ viewport: { width: 390, height: 960 } });
        const fixture = await mountAddressFixture(context, true);
        const page = await context.newPage();
        await page.goto(toolOrigin + '/');
        await page.getByRole('button', { name: '提取地址', exact: true }).click();
        const retry = page.getByRole('button', { name: '核对原提取请求' });
        await expect(retry).toBeEnabled();
        await retry.click();
        await expect(page.getByRole('button', { name: /下次可提取/ })).toBeDisabled();
        assert.equal(fixture.writes, 1);
        const other = await context.newPage();
        await other.goto(toolOrigin + '/');
        await expect(other.getByRole('button', { name: /下次可提取/ })).toBeDisabled();
        results.push({ page: 'recovery-and-shared-browser', passed: true, writes: 1 });
        await context.close();
    }
    {
        const context = await browser.newContext({ viewport: { width: 390, height: 960 } });
        await mountAddressFixture(context);
        const page = await context.newPage();
        const parent = 'http://127.0.0.1:5189/e2e/tax-free-address/';
        await page.goto(parent);
        await page.getByRole('link', { name: /免税地址提取/ }).click();
        await expect(page.getByRole('button', { name: '返回上一页' })).toBeVisible();
        assert.equal(new URL(page.url()).hash, '');
        assert.equal(await page.evaluate(() => document.referrer), '');
        await page.reload();
        await page.getByRole('button', { name: '返回上一页' }).click();
        await expect(page).toHaveURL(parent);
        results.push({ page: 'storefront-return', passed: true });
        await context.close();
    }
    for (const width of [390, 1440])
        for (const theme of ['light', 'dark']) {
            const context = await browser.newContext({
                viewport: { width, height: 960 },
                permissions: ['clipboard-read', 'clipboard-write'],
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('http://127.0.0.1:5349/e2e/tax-free-address/?theme=' + theme);
            await expect(page.getByRole('button', { name: '提取并复制', exact: true }).first()).toBeVisible();
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
                true,
            );
            const screenshot = 'admin-' + width + '-' + theme + '.png';
            await page.screenshot({ path: output + screenshot });
            await page.getByRole('button', { name: '生成地址', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: '生成地址', exact: true }).click();
            await expect(page.getByText('已生成 100 条未使用地址。', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: '提取并复制', exact: true }).first().click();
            await page.getByRole('button', { name: /已使用 \(1\)/ }).click();
            await expect(page.getByRole('button', { name: '复制地址', exact: true })).toBeVisible();
            await page.getByRole('button', { name: '清理已使用', exact: true }).click();
            await expect(page.getByRole('dialog')).toContainText('1 条');
            await page.getByRole('button', { name: '确认清理', exact: true }).click();
            await expect(page.getByText('暂无已使用地址。', { exact: true })).toBeVisible();
            assert.equal(await page.evaluate(() => window.__taxFixture.writes), 3);
            assert.deepEqual(errors, []);
            results.push({ page: 'admin', width, theme, screenshot, passed: true });
            await context.close();
        }
    await writeFile(
        output + 'browser-results.json',
        JSON.stringify(
            { fixture: 'synthetic data; compiled standalone app and production admin components', results },
            null,
            2,
        ) + '\n',
    );
    process.stdout.write(JSON.stringify({ passed: results.length, output }) + '\n');
} catch (error) {
    await writeFile(
        output + 'browser-failure.json',
        JSON.stringify({ results, error: String(error) }, null, 2),
    );
    throw error;
} finally {
    await browser.close();
}
