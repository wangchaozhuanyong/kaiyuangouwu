import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import {
    extractDashboardAssetUrls,
    extractEntryTicket,
    extractStorefrontAssetUrl,
    verifyDashboardAssets,
    verifyProductionRelease,
} from '../../../deploy/verify-production-release.mjs';

async function startFixtureServer({
    requirePromotionCookie = false,
    redirectStorefrontToPromo = false,
} = {}) {
    const server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        const hasEntryCookie = request.headers.cookie === 'storefront-entry=signed-cookie';

        if (request.method === 'GET' && requestUrl.pathname === '/health') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end('{"status":"ok"}');
            return;
        }
        if (request.method === 'POST' && requestUrl.pathname === '/shop-api') {
            if (!hasEntryCookie && requirePromotionCookie) {
                response.writeHead(403, { 'content-type': 'application/json' });
                response.end(
                    JSON.stringify({
                        errors: [
                            {
                                extensions: { code: 'STOREFRONT_ENTRY_REQUIRED' },
                            },
                        ],
                    }),
                );
                return;
            }
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end('{"data":{"__typename":"Query"}}');
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/promo') {
            response.writeHead(200, { 'content-type': 'text/html' });
            response.end(
                '<form action="/promo/enter"><input value="signed&amp;ticket" name="ticket"></form>',
            );
            return;
        }
        if (request.method === 'POST' && requestUrl.pathname === '/promo/enter') {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', chunk => {
                body += chunk;
            });
            request.on('end', () => {
                if (new URLSearchParams(body).get('ticket') !== 'signed&ticket') {
                    response.writeHead(403);
                    response.end();
                    return;
                }
                response.writeHead(303, {
                    location: '/',
                    'set-cookie': 'storefront-entry=signed-cookie; Path=/; HttpOnly; SameSite=Lax',
                });
                response.end();
            });
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/') {
            if (!hasEntryCookie && redirectStorefrontToPromo) {
                response.writeHead(302, { location: '/promo' });
                response.end();
                return;
            }
            response.writeHead(200, { 'content-type': 'text/html' });
            response.end('<html><head><link href="/assets/index-test.css" rel="stylesheet"></head></html>');
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/assets/index-test.css') {
            response.writeHead(200, { 'content-type': 'text/css' });
            response.end('body{}');
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/dashboard/') {
            response.writeHead(200, { 'content-type': 'text/html' });
            response.end(
                '<html><head><link href="/dashboard/assets/dashboard.css" rel="stylesheet"></head>' +
                    '<body><script src="/dashboard/assets/dashboard-main.js"></script></body></html>',
            );
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/dashboard/assets/dashboard.css') {
            response.writeHead(200, { 'content-type': 'text/css' });
            response.end('body{}');
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/dashboard/assets/dashboard-main.js') {
            response.writeHead(200, { 'content-type': 'application/javascript' });
            response.end('const chunk = "assets/dashboard-lazy.js";');
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/dashboard/assets/dashboard-lazy.js') {
            response.writeHead(200, { 'content-type': 'application/javascript' });
            response.end('export const loaded = true;');
            return;
        }
        if (request.method === 'POST' && requestUrl.pathname === '/admin-api') {
            response.writeHead(404);
            response.end();
            return;
        }
        response.writeHead(404);
        response.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return {
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
    };
}

test('verifies the direct storefront, optional promotion entry and production public surfaces', async t => {
    const fixture = await startFixtureServer();
    t.after(fixture.close);

    const checks = await verifyProductionRelease({
        storefrontUrl: fixture.origin,
        dashboardUrl: `${fixture.origin}/dashboard/`,
        timeoutMs: 1_000,
    });

    assert.deepEqual(checks, [
        'public health',
        'dashboard health',
        'public Shop API',
        'direct storefront',
        'optional promotion page',
        'optional promotion entry',
        'storefront build asset',
        'dashboard asset graph',
        'public Admin API denial',
    ]);
});

test('rejects a dashboard origin without its same-origin health route', async () => {
    const fetchImpl = async url => {
        const requestUrl = new URL(url);
        if (requestUrl.origin === 'https://store.example.com' && requestUrl.pathname === '/health') {
            return new Response('{"status":"ok"}', {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return new Response('', { status: 404 });
    };

    await assert.rejects(
        verifyProductionRelease({
            storefrontUrl: 'https://store.example.com',
            dashboardUrl: 'https://console.example.com/dashboard/',
            fetchImpl,
            timeoutMs: 1_000,
        }),
        /Dashboard health endpoint: expected HTTP 200, received 404/u,
    );
});

test('rejects a Shop API that still requires a promotion cookie', async t => {
    const fixture = await startFixtureServer({ requirePromotionCookie: true });
    t.after(fixture.close);

    await assert.rejects(
        verifyProductionRelease({
            storefrontUrl: fixture.origin,
            dashboardUrl: `${fixture.origin}/dashboard/`,
            timeoutMs: 1_000,
        }),
        /Public Shop API: expected HTTP 200, received 403/u,
    );
});

test('rejects a main storefront that still redirects to the promotion page', async t => {
    const fixture = await startFixtureServer({ redirectStorefrontToPromo: true });
    t.after(fixture.close);

    await assert.rejects(
        verifyProductionRelease({
            storefrontUrl: fixture.origin,
            dashboardUrl: `${fixture.origin}/dashboard/`,
            timeoutMs: 1_000,
        }),
        /Direct storefront: expected HTTP 200, received 302/u,
    );
});

test('extracts tickets and same-origin build assets without depending on attribute order', () => {
    assert.equal(extractEntryTicket('<input value="abc&amp;123" type="hidden" name="ticket">'), 'abc&123');
    assert.equal(
        extractStorefrontAssetUrl(
            '<script defer src="https://shop.example.com/assets/index.js?v=1"></script>',
            'https://shop.example.com',
        ).href,
        'https://shop.example.com/assets/index.js?v=1',
    );
    assert.throws(
        () =>
            extractStorefrontAssetUrl(
                '<script src="https://untrusted.example/assets/index.js"></script>',
                'https://shop.example.com',
            ),
        /same-origin/u,
    );
    assert.deepEqual(
        extractDashboardAssetUrls(
            '<script defer src="/dashboard/assets/index.js"></script>',
            'https://console.example.com/dashboard/',
        ).map(url => url.href),
        ['https://console.example.com/dashboard/assets/index.js'],
    );
});

test('rejects a missing lazy Dashboard chunk even when the entry asset is healthy', async () => {
    const responses = new Map([
        [
            '/dashboard/',
            new Response('<script src="/dashboard/assets/main.js"></script>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        ],
        [
            '/dashboard/assets/main.js',
            new Response('const lazy = "assets/missing.js";', {
                status: 200,
                headers: { 'content-type': 'application/javascript' },
            }),
        ],
    ]);
    const fetchImpl = async url =>
        responses.get(new URL(url).pathname)?.clone() ?? new Response('', { status: 404 });

    await assert.rejects(
        verifyDashboardAssets({
            dashboardUrl: 'https://console.example.com/dashboard/',
            fetchImpl,
            releaseId: 'test-release',
            timeoutMs: 1_000,
        }),
        /missing\.js.*expected HTTP 200, received 404/u,
    );
});

test('verifies Dashboard assets against the final canonical origin after an entry redirect', async () => {
    const requests = [];
    const fetchImpl = async url => {
        const requestUrl = new URL(url);
        requests.push(requestUrl.href);
        if (
            requestUrl.origin === 'https://legacy-console.example.com' &&
            requestUrl.pathname === '/dashboard/'
        ) {
            const response = new Response('<script src="/dashboard/assets/canonical-main.js"></script>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            });
            Object.defineProperty(response, 'url', {
                value: 'https://console.example.com/dashboard/?__release=test-release',
            });
            return response;
        }
        if (
            requestUrl.origin === 'https://console.example.com' &&
            requestUrl.pathname === '/dashboard/assets/canonical-main.js'
        ) {
            return new Response('export const ready = true;', {
                status: 200,
                headers: { 'content-type': 'application/javascript' },
            });
        }
        return new Response('', { status: 404 });
    };

    const result = await verifyDashboardAssets({
        dashboardUrl: 'https://legacy-console.example.com/dashboard/',
        fetchImpl,
        releaseId: 'test-release',
        timeoutMs: 1_000,
    });

    assert.deepEqual(result, { assetCount: 1 });
    assert.ok(
        requests.some(request =>
            request.startsWith('https://console.example.com/dashboard/assets/canonical-main.js?'),
        ),
    );
    assert.ok(
        requests.every(
            request =>
                !request.startsWith('https://legacy-console.example.com/dashboard/assets/canonical-main.js'),
        ),
    );
});
