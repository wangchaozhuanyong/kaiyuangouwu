import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.RECHARGE_PREVIEW_PORT || 5198);
const origin = 'http://recharge.localhost:' + port;
const allowedAsset = /^\/assets\/(?:[A-Za-z0-9._-]+\.(?:js|css)|daylight-dial-[A-Za-z0-9_-]+\.svg)$/;
const assets = await readdir(new URL('../../dist-recharge-tool/assets/', import.meta.url));
assert.deepEqual(
    assets.filter(file => !allowedAsset.test('/assets/' + file)),
    [],
    'Unexpected media in standalone build',
);
const output = new URL('../../../../outputs/recharge-standalone/', import.meta.url);
await mkdir(output, { recursive: true });
const localPreview = await fetch('http://127.0.0.1:' + port + '/', { method: 'HEAD' });
assert.equal(localPreview.headers.get('x-recharge-preview'), 'synthetic-local');
const partnerCode = 'RA-' + 'A'.repeat(32);
const screenshot = (page, name) =>
    page.screenshot({
        path: fileURLToPath(new URL(name + '.png', output)),
        fullPage: true,
        animations: 'disabled',
    });

async function assertNeutral(page, authorizationReady = false) {
    await expect(page.locator('body')).not.toContainText(
        /MOYAO|模钥|购物车|查看商品|联系商城客服|Add to cart|View products/i,
    );
    await expect(
        page.locator('input[type=password], textarea, #gpt-session, a[href*="api/auth/session"]'),
    ).toHaveCount(0);
    assert(!/MOYAO|模钥/i.test(await page.title()));
    const urls = await page.locator('a[href]').evaluateAll(links => links.map(link => link.href));
    for (const href of urls) {
        const link = new URL(href);
        if (authorizationReady && link.hostname === 'authorization.example.test') continue;
        assert.equal(link.origin, origin, 'Unexpected link from standalone page');
        assert.equal(link.pathname, '/', 'Unexpected path linked from standalone page');
    }
    assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Horizontal overflow',
    );
}

function tab(page, name) {
    return page.getByRole('navigation').getByText(name, { exact: true });
}

function input(page) {
    return page.getByRole('textbox').first();
}

function generateLinkButton(page) {
    return page.getByRole('button', { name: '生成授权链接', exact: true });
}

const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP recharge.localhost 127.0.0.1'],
});
try {
    for (const { width, height } of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
    ]) {
        const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
        await context.addCookies([{ name: 'preview_only', value: 'synthetic', url: origin }]);
        const unexpected = [];
        const apiCalls = new Set();
        const errors = [];
        await context.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === origin && (url.pathname === '/' || allowedAsset.test(url.pathname))) {
                return route.continue();
            }
            const match = /^\/api\/recharge\/(config|verify|query|authorize|task|challenge|events)$/.exec(
                url.pathname,
            );
            if (url.origin === origin && match && request.method() === 'POST') {
                const headers = await request.allHeaders();
                if (headers.cookie || headers.authorization || headers['vendure-token']) {
                    unexpected.push('Unexpected credential header for ' + match[1]);
                }
                apiCalls.add(match[1]);
                return route.continue();
            }
            unexpected.push(url.origin + url.pathname);
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
        await expect(input(page)).toBeVisible();
        await assertNeutral(page);
        await screenshot(page, 'recharge-' + width);

        // Simulate configuration read failure without real requests or business writes.
        await page.route('**/api/recharge/config', route => route.fulfill({ status: 503, body: '{}' }));
        await page.reload();
        await expect(page.getByRole('button', { name: /重新检查|重新加载|重试/ }).first()).toBeVisible();
        await page.unroute('**/api/recharge/config');
        await page
            .getByRole('button', { name: /重新检查|重新加载|重试/ })
            .first()
            .click();
        await expect(input(page)).toBeVisible();

        await input(page).fill('DEMO-500');
        await page.getByRole('button', { name: /验证兑换码|验证并继续/ }).click();
        await expect(page.locator('.gpt-recharge-plan-list [aria-current]')).toHaveText('Pro500');
        await assertNeutral(page);

        await tab(page, '兑换码查询').click();
        await expect(page).toHaveURL(/[?&]tab=query/);
        await page.reload();
        await input(page).fill('DEMO-500');
        await page.getByRole('button', { name: /查询进度|查进度/ }).click();
        await expect(page.locator('.gpt-recharge-task-details')).toContainText('Pro500');
        await assertNeutral(page);
        await screenshot(page, 'lookup-' + width);

        await tab(page, '使用说明').click();
        await expect(page).toHaveURL(/[?&]tab=guide/);
        await page.reload();
        await assertNeutral(page);
        await screenshot(page, 'guide-' + width);
        await page.goBack();
        // Browser back should restore the query tab in the standalone document.
        await expect(page).toHaveURL(/[?&]tab=query/);
        await tab(page, '自助充值').click();
        await input(page).fill(partnerCode);
        await page.getByRole('button', { name: /验证兑换码|验证并继续/ }).click();
        await expect(page.locator('.gpt-recharge-plan-list [aria-current]')).toHaveText('Pro500');
        const originalAuthorization = page.waitForRequest(request =>
            request.url().endsWith('/api/recharge/authorize'),
        );
        await page.getByRole('button', { name: /生成授权链接|开始授权/ }).click();
        const originalRequestKey = (await originalAuthorization).postDataJSON().requestKey;
        const authorize = page.locator('a[href*="authorization.example.test"]');
        await expect(authorize).toHaveAttribute('target', '_blank');
        await expect(authorize).toHaveAttribute('rel', /noreferrer/);
        await assertNeutral(page, true);
        await screenshot(page, 'authorization-' + width);

        // A fresh lookup can resume a newer link even when this tab has an older request key.
        const submitLookup = () => page.getByRole('button', { name: '查询进度', exact: true }).click();
        const verifyCode = () => page.getByRole('button', { name: '验证兑换码', exact: true }).click();
        const generateLink = () => generateLinkButton(page).click();
        await tab(page, '兑换码查询').click();
        await page.locator('#gpt-query').fill(partnerCode);
        await submitLookup();
        const resume = page.getByRole('button', { name: '继续账号授权', exact: true });
        await expect(resume).toBeVisible();
        await page.locator('#gpt-query').fill('different-draft-code');
        await expect(resume).toHaveCount(0);
        await page.locator('#gpt-query').fill(partnerCode);
        const authorizeRoute = '**/api/recharge/authorize';
        const challengeRoute = '**/api/recharge/challenge';
        await page.route(authorizeRoute, async route => {
            if ((await route.request().allHeaders())['x-shop-abuse-answer']) return route.fallback();
            return route.fulfill({
                json: {
                    errors: [
                        {
                            message: 'Synthetic verification needed',
                            extensions: { code: 'SHOP_ABUSE_CHALLENGE_REQUIRED', action: 'RECHARGE_SUBMIT' },
                        },
                    ],
                },
            });
        });
        await page.route(challengeRoute, route =>
            route.fulfill({
                json: {
                    data: {
                        createShopAbuseChallenge: {
                            id: 'synthetic-challenge',
                            imageDataUrl:
                                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kv/8AAAAASUVORK5CYII=',
                            expiresAt: new Date(Date.now() + 120000).toISOString(),
                        },
                    },
                },
            }),
        );
        const resumed = page.waitForRequest(request => request.url().endsWith('/api/recharge/authorize'));
        await resume.click();
        const firstAttempt = (await resumed).postDataJSON();
        assert.equal(firstAttempt.code, partnerCode);
        assert.notEqual(firstAttempt.requestKey, originalRequestKey);
        await page.locator('.shop-abuse-challenge input').fill('ABC234');
        const resumedWithProof = page.waitForRequest(request =>
            request.url().endsWith('/api/recharge/authorize'),
        );
        await generateLink();
        const submitted = await resumedWithProof;
        assert.deepEqual(submitted.postDataJSON(), firstAttempt);
        assert.equal((await submitted.allHeaders())['x-shop-abuse-id'], 'synthetic-challenge');
        await expect(authorize).toBeVisible();
        await page.unroute(authorizeRoute);
        await page.unroute(challengeRoute);

        const expiredTask = {
            id: 'preview-expired',
            credential: 'synthetic-expired-proof',
            plan: 'pro500',
            status: 'expired',
            updatedAt: '2026-11-20T09:00:00.000Z',
        };
        await page.goto(origin);
        await page.locator('#gpt-code').fill('different-draft-code');
        await tab(page, '兑换码查询').click();
        await page.route('**/api/recharge/query', route =>
            route.fulfill({
                json: {
                    data: {
                        queryGptRechargeCode: { plan: 'pro500', status: 'available', task: expiredTask },
                    },
                },
            }),
        );
        await page.locator('#gpt-query').fill(partnerCode);
        await submitLookup();
        await page.getByRole('button', { name: '重新发起授权', exact: true }).click();
        await expect(page.locator('#gpt-code')).toHaveValue(partnerCode);
        await expect(generateLinkButton(page)).toHaveCount(0);
        await page.unroute('**/api/recharge/query');
        await verifyCode();

        let previousRequestKey;
        await page.route('**/api/recharge/authorize', async route => {
            previousRequestKey = route.request().postDataJSON().requestKey;
            await route.fulfill({ status: 504, json: {} });
        });
        await generateLink();
        await expect(page.getByRole('heading', { name: '授权请求待确认' })).toBeVisible();
        await expect(generateLinkButton(page)).toHaveCount(0);
        await page.getByRole('button', { name: '查询原任务', exact: true }).click();
        await expect(page.locator('#gpt-query')).toHaveValue(partnerCode);
        await page.route('**/api/recharge/query', route =>
            route.fulfill({
                json: { data: { queryGptRechargeCode: { plan: 'pro500', status: 'available', task: null } } },
            }),
        );
        await submitLookup();
        await page.getByRole('button', { name: '使用原码重新验证', exact: true }).click();
        await expect(page.locator('#gpt-code')).toHaveValue(partnerCode);
        await verifyCode();
        await page.unroute('**/api/recharge/authorize');
        let nextRequestKey;
        await page.route('**/api/recharge/authorize', async route => {
            nextRequestKey = route.request().postDataJSON().requestKey;
            await route.fulfill({
                json: {
                    data: {
                        startGptRechargeAuthorization: {
                            task: { ...expiredTask, status: 'failed', updatedAt: '2026-11-20T09:02:00.000Z' },
                        },
                    },
                },
            });
        });
        await generateLink();
        await expect(page.getByText('请保留兑换码并联系发码方核对。请勿重复提交或更换账号。')).toBeVisible();
        assert.equal(nextRequestKey, previousRequestKey, 'Explicit recovery uses the original request key');
        await page.getByRole('button', { name: '兑换下一单', exact: true }).click();
        await expect(page.locator('#gpt-code')).toHaveValue('');
        await expect(page.locator('.gpt-recharge-task-details')).toHaveCount(0);
        await page.unroute('**/api/recharge/authorize');
        await page.unroute('**/api/recharge/query');

        await tab(page, '兑换码查询').click();
        await page.route('**/api/recharge/query', route =>
            route.fulfill({
                json: {
                    data: {
                        queryGptRechargeCode: {
                            plan: 'pro500',
                            status: 'reserved',
                            reason: 'manual_review_required',
                            task: null,
                        },
                    },
                },
            }),
        );
        await page.locator('#gpt-query').fill(partnerCode);
        await submitLookup();
        await expect(page.getByText('请保留原兑换码并联系发码方核对。')).toBeVisible();
        await page.unroute('**/api/recharge/query');

        await page.goto(origin + '/?tab=guide&lang=en');
        await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
        await expect(tab(page, 'Guide')).toBeVisible();
        await assertNeutral(page);
        assert.deepEqual(unexpected, []);
        assert.deepEqual(errors, []);
        for (const operation of ['config', 'verify', 'query', 'authorize']) {
            assert(apiCalls.has(operation), 'Missing request for ' + operation);
        }
        await context.close();
    }
    const scopedPath = '/p/preview-partner';
    const scopedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const scopedCalls = new Set();
    const rejectedRequests = [];
    await scopedContext.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin && (url.pathname === scopedPath || allowedAsset.test(url.pathname))) {
            return route.continue();
        }
        if (url.origin === origin && url.pathname.startsWith(scopedPath + '/api/recharge/')) {
            scopedCalls.add(url.pathname.slice((scopedPath + '/api/recharge/').length));
            return route.continue();
        }
        rejectedRequests.push(url.origin + url.pathname);
        return route.abort();
    });
    const scoped = await scopedContext.newPage();
    await scoped.goto(origin + scopedPath);
    await expect(scoped.locator('#gpt-code')).toBeVisible();
    await tab(scoped, '兑换码查询').click();
    await scoped.getByRole('button', { name: 'English' }).click();
    await expect(scoped).toHaveURL(origin + scopedPath + '?tab=query&lang=en');
    await scoped.reload();
    await expect(tab(scoped, 'Code lookup')).toBeVisible();
    await scoped.locator('#gpt-query').fill(partnerCode);
    await scoped.getByRole('button', { name: 'Check progress', exact: true }).click();
    await expect(scoped.getByText('Connected', { exact: true })).toBeVisible();
    await scoped.getByRole('button', { name: 'Resume account authorization' }).click();
    await expect(scoped).toHaveURL(origin + scopedPath + '?lang=en');
    await expect(scoped.locator('a[href*="authorization.example.test"]')).toBeVisible();
    for (const operation of ['config', 'query', 'authorize', 'events']) {
        assert(scopedCalls.has(operation), 'Missing partner-scoped request for ' + operation);
    }
    assert.deepEqual(rejectedRequests, [], 'All scoped requests must stay under the same partner');
    await scopedContext.close();

    const localhost = 'http://127.0.0.1:' + port;
    for (const path of [
        '/products',
        '/products/chatgpt-plus',
        '/collections',
        '/storefront/hero-01-gateway.jpg',
        '/assets/hero-cloudbridge-ai-hub-480-DWWdu4lw.webp',
        '/assets/account-services-v1-C9QSiatF.png',
        '/assets/coupon-C7fFs5ym.svg',
        '/cart',
        '/account',
        '/shop-api',
        '/admin-api',
        '/api/recharge/submit',
        '/p/unknown-partner',
        '/p/unknown-partner/api/recharge/config',
    ]) {
        const response = await fetch(localhost + path);
        assert.equal(response.status, 404, path);
    }
    process.stdout.write(
        'Passed standalone browser checks at 1440px and 390px with synthetic recharge responses.\n',
    );
} finally {
    await browser.close();
}
