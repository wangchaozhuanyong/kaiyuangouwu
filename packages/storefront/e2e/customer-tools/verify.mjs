import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette.ts';

const output = fileURLToPath(new URL('../../../../outputs/customer-tools-redesign/', import.meta.url));
await mkdir(output, { recursive: true });
const entry = 'http://127.0.0.1:5196/e2e/customer-tools/index.html';
const tools = {
    '2fa': { origin: 'https://2fa.moyaoai.com', dist: new URL('../../dist-two-factor/', import.meta.url) },
    mail: { origin: 'https://mail.moyaoai.com', dist: new URL('../../dist/.mail-tool/', import.meta.url) },
};
const selectedTools = Object.entries(tools).filter(
    ([name]) => !process.env.CUSTOMER_TOOL_ONLY || name === process.env.CUSTOMER_TOOL_ONLY,
);
const nginx = await readFile(new URL('../../../../deploy/nginx/damatong.conf', import.meta.url), 'utf8');
const result = {
    success: true,
    message: null,
    targetType: 'buyer',
    aliasEmail: 'fixture@example.test',
    primaryEmail: null,
    codeExpiresAt: null,
    remainingDays: null,
    totalEmails: 1,
    virtualEmailsList: [],
    items: [
        {
            id: 'fixture-mail',
            fromAddress: 'sender@example.test',
            fromName: 'Fixture',
            subject: 'Test message',
            receivedAt: '2026-11-16T00:00:00Z',
            extractedCode: '123456',
            bodyText: 'Synthetic mail',
            bodyHtml:
                '<meta http-equiv="Content-Security-Policy" content="img-src data:">' +
                '<style>.email-body{max-width:700px;margin:auto;font-family:system-ui}</style>' +
                '<div class="email-body"><h1>邮件正文预览</h1><img src="https://images.example.test/preview.jpg" width="700">' +
                '<script>window.parent.mailSenderScriptRan=true</script>' +
                Array.from(
                    { length: 12 },
                    () => '<p style="padding:20px 0">Synthetic long email content.</p>',
                ).join('') +
                '</div>',
            targetEmail: 'fixture@example.test',
            virtualEmailId: null,
        },
    ],
};
async function mount(context) {
    const fixture = { requests: [], rejected: [], fail: false, imageRequests: 0, failImage: false };
    await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === new URL(entry).origin) return route.continue();
        if (url.origin === 'https://images.example.test') {
            fixture.imageRequests++;
            assert.equal(await req.headerValue('referer'), null);
            return route.fulfill({
                status: fixture.failImage ? 503 : 200,
                contentType: 'image/jpeg',
                headers: { 'Cache-Control': 'no-store' },
                body: fixture.failImage
                    ? ''
                    : await readFile(new URL('../../public/storefront/hero-01-gateway.jpg', import.meta.url)),
            });
        }
        const tool = Object.values(tools).find(candidate => candidate.origin === url.origin);
        if (!tool) {
            fixture.rejected.push(url.origin);
            return route.abort();
        }
        fixture.requests.push({ origin: url.origin, path: url.pathname, method: req.method() });
        assert.equal(await req.headerValue('referer'), null);
        if (url.pathname === '/api/mail/query' && tool === tools.mail) {
            assert.equal(req.method(), 'POST');
            assert.equal(await req.headerValue('cookie'), null);
            assert.equal(await req.headerValue('authorization'), null);
            return route.fulfill({ status: fixture.fail ? 503 : 200, json: fixture.fail ? {} : result });
        }
        if (url.pathname === '/api/mail/events' && tool === tools.mail)
            return route.fulfill({ status: 409, json: { error: 'realtime_unavailable' } });
        if (url.pathname === '/' || (tool === tools['2fa'] && url.pathname === '/index.html')) {
            return route.fulfill({
                body: await readFile(new URL('index.html', tool.dist)),
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Referrer-Policy': 'no-referrer',
                    'Content-Security-Policy': nginx
                        .slice(nginx.indexOf(`server_name ${url.hostname};`))
                        .match(/add_header Content-Security-Policy "([^"]+)" always;/)[1],
                },
            });
        }
        const asset = /^\/assets\/[A-Za-z0-9_-]+\.(js|css|svg)$/.exec(url.pathname);
        if (asset)
            return route.fulfill({
                body: await readFile(new URL(url.pathname.slice(1), tool.dist)),
                contentType: { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' }[asset[1]],
            });
        fixture.rejected.push(url.pathname);
        return route.fulfill({ status: 404 });
    });
    return fixture;
}
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
    for (const width of [390, 1440])
        for (const lang of ['zh', 'en'])
            for (const preset of ['classic', 'neo-minimalist']) {
                for (const [name, tool] of selectedTools) {
                    const context = await browser.newContext({
                        viewport: { width, height: 960 },
                        reducedMotion: 'reduce',
                    });
                    const fixture = await mount(context);
                    const page = await context.newPage();
                    const errors = [];
                    page.on('pageerror', error => errors.push(error.message));
                    await page.goto(tool.origin + '/?lang=' + lang);
                    await expect(page.locator('main')).toBeVisible();
                    await page.evaluate(
                        vars => {
                            for (const [key, value] of Object.entries(vars))
                                document.documentElement.style.setProperty(key, value);
                        },
                        {
                            ...semanticPaletteCssVariables(resolveStorefrontSemanticPalette(preset)),
                            ...storefrontSkinCssVariables(preset),
                        },
                    );
                    await expect(page.locator('.page-back-button, a, nav')).toHaveCount(0);
                    if (name === '2fa') {
                        await page.locator('#storefront-two-factor-secret').fill('JBSWY3DPEHPK3PXP');
                        await page
                            .getByRole('button', {
                                name: lang === 'zh' ? '查询动态码' : 'Generate code',
                                exact: true,
                            })
                            .click();
                        await expect(page.locator('.two-factor-query-result p')).toHaveText(/\d{3}\s\d{3}/);
                        assert.equal(
                            fixture.requests.some(request => request.method !== 'GET'),
                            false,
                        );
                    } else {
                        const columns = await page
                            .locator('.mail-query-layout')
                            .evaluate(
                                element => getComputedStyle(element).gridTemplateColumns.split(' ').length,
                            );
                        assert.equal(columns, 1);
                        await page.locator('#codeInput').fill('CaseSensitiveFixture');
                        await page.locator('#queryBtn').click();
                        await expect(page.locator('.otp-code-text')).toHaveText('123456');
                        if (width < 768) await page.locator('.mail-reader-list > button').first().click();
                        await expect(page.locator('.mail-reader-message')).toBeVisible();
                        assert.equal(fixture.imageRequests, 0);
                        const frame = page.frameLocator('.mail-iframe');
                        await expect(frame.locator('#mail-preview-content')).toBeVisible();
                        await expect
                            .poll(() =>
                                page
                                    .locator('.mail-iframe')
                                    .evaluate(el => el.getBoundingClientRect().height),
                            )
                            .toBeGreaterThan(800);
                        const accessDenied = await frame.locator('body').evaluate(() => {
                            try {
                                void window.parent.document.body;
                                return false;
                            } catch {
                                return true;
                            }
                        });
                        assert.equal(accessDenied, true);
                        assert.equal(await page.evaluate(() => window.mailSenderScriptRan), undefined);
                        await page
                            .getByRole('button', {
                                name: lang === 'zh' ? '显示邮件图片' : 'Show email images',
                                exact: true,
                            })
                            .click();
                        await expect.poll(() => fixture.imageRequests).toBeGreaterThan(0);
                        await expect
                            .poll(() =>
                                frame.locator('img').evaluate(el => el.complete && el.naturalWidth > 0),
                            )
                            .toBe(true);
                        const imageFits = await frame
                            .locator('img')
                            .evaluate(el => el.getBoundingClientRect().width <= innerWidth + 1);
                        assert.equal(imageFits, true);
                        await page.screenshot({
                            path: output + `mail-reader-${width}-${lang}-${preset}.png`,
                            fullPage: true,
                        });
                        await page
                            .getByRole('button', {
                                name: lang === 'zh' ? '全屏阅读' : 'Full screen',
                                exact: true,
                            })
                            .click();
                        await expect(page.getByRole('dialog')).toBeVisible();
                        await page.keyboard.press('Escape');
                        await expect(page.getByRole('dialog')).toHaveCount(0);
                        fixture.failImage = true;
                        await page
                            .getByRole('button', {
                                name: lang === 'zh' ? '隐藏图片' : 'Hide images',
                                exact: true,
                            })
                            .click();
                        await expect(frame.locator('img')).toHaveCount(0);
                        await page
                            .getByRole('button', {
                                name: lang === 'zh' ? '显示邮件图片' : 'Show email images',
                                exact: true,
                            })
                            .click();
                        await expect(page.locator('.mail-image-feedback')).toBeVisible();
                        fixture.failImage = false;
                        await page
                            .getByRole('button', {
                                name: lang === 'zh' ? '重试图片' : 'Retry images',
                                exact: true,
                            })
                            .click();
                        await expect
                            .poll(() =>
                                frame.locator('img').evaluate(el => el.complete && el.naturalWidth > 0),
                            )
                            .toBe(true);
                        await expect(page.locator('.mail-image-feedback')).toHaveCount(0);
                        await page.locator('.page-back-button').click();
                        await expect(page.locator('#codeInput')).toBeVisible();
                        await expect(page.locator('.page-back-button, a')).toHaveCount(0);
                    }
                    assert.ok(
                        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
                    );
                    const screenshot = `${name}-${width}-${lang}-${preset}.png`;
                    await page.screenshot({ path: output + screenshot, fullPage: true });
                    await page.reload();
                    await expect(page.locator('main')).toBeVisible();
                    await expect(page.locator('.page-back-button, a')).toHaveCount(0);
                    assert.deepEqual(errors, []);
                    assert.deepEqual(fixture.rejected, []);
                    checks.push({ name, width, lang, preset, direct: true, refresh: true, screenshot });
                    await context.close();
                }
            }
    for (const [name, tool] of selectedTools) {
        const context = await browser.newContext();
        const fixture = await mount(context);
        const page = await context.newPage();
        await page.goto(entry);
        const link = page.locator(`a[href="${tool.origin}/"]`);
        await expect(link).toBeVisible();
        const shared = await link.getAttribute('href');
        assert.ok(!shared.includes('#back'));
        await link.click();
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('.page-back-button')).toBeVisible();
        assert.equal(new URL(page.url()).hash, '');
        await page.reload();
        await page.locator('.page-back-button').click();
        await expect(page).toHaveURL(entry);
        const newTab = await context.newPage();
        await newTab.goto(shared);
        await expect(newTab.locator('main')).toBeVisible();
        await expect(newTab.locator('.page-back-button, a')).toHaveCount(0);
        assert.deepEqual(fixture.rejected, []);
        checks.push({ name, sameTabBack: true, copiedLink: true });
        await context.close();
    }
    const failureContext = await browser.newContext();
    const failureFixture = await mount(failureContext);
    failureFixture.fail = true;
    const failurePage = await failureContext.newPage();
    await failurePage.goto(tools.mail.origin);
    await failurePage.locator('#codeInput').fill('CaseSensitiveFixture');
    await failurePage.locator('#queryBtn').click();
    await expect(failurePage.locator('.toast-msg.error')).toBeVisible();
    await expect(failurePage.locator('#codeInput')).toHaveValue('CaseSensitiveFixture');
    await expect(failurePage.locator('.page-back-button, a')).toHaveCount(0);
    checks.push({ name: 'mail', failureKeepsInput: true });
    await failureContext.close();
    await writeFile(
        output +
            `browser-results${process.env.CUSTOMER_TOOL_ONLY ? '-' + process.env.CUSTOMER_TOOL_ONLY : ''}.json`,
        JSON.stringify({ source: 'built local artifacts; synthetic mail API responses', checks }, null, 2),
    );
    process.stdout.write(`Passed ${checks.length} browser scenarios\n`);
} finally {
    await browser.close();
}
