import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateProductionStorefronts } from '../../../deploy/production-storefronts.mjs';
import {
    requestPreparedDocument,
    verifyConfiguredProductionStorefronts,
} from '../../../deploy/verify-production-storefronts.mjs';

const threeStores = {
    dashboardUrl: 'https://admin.example.test/dashboard/',
    storefronts: [
        { origin: 'https://alpha.example.test', expectedChannelCode: 'alpha' },
        { origin: 'https://bravo.example.test', expectedChannelCode: 'bravo' },
        { origin: 'https://charlie.example.test', expectedChannelCode: 'charlie' },
    ],
};

void test('production storefront config accepts any number of unique stores', () => {
    assert.deepEqual(validateProductionStorefronts(threeStores), threeStores);
});

void test('production routes MOYAO through its dedicated Channel', async () => {
    const config = JSON.parse(
        await readFile(new URL('../../../deploy/production-storefronts.json', import.meta.url), 'utf8'),
    );
    const moyao = config.storefronts.find(store => store.origin === 'https://moyaoai.com');
    assert.equal(moyao?.expectedChannelCode, 'moyao-ai');
});

void test('the default release and monitoring scope includes the activated Flash Cast storefront', async () => {
    const config = validateProductionStorefronts(
        JSON.parse(
            await readFile(new URL('../../../deploy/production-storefronts.json', import.meta.url), 'utf8'),
        ),
    );
    assert.deepEqual(
        config.storefronts.find(store => store.origin === 'https://shop.flashcast.com.my'),
        { origin: 'https://shop.flashcast.com.my', expectedChannelCode: 'flashcast-mall' },
    );
});

void test('production storefront config rejects duplicate routes and Channels', () => {
    assert.throws(
        () =>
            validateProductionStorefronts({
                ...threeStores,
                storefronts: [...threeStores.storefronts, { ...threeStores.storefronts[0] }],
            }),
        /Duplicate storefront origin/u,
    );
    assert.throws(
        () =>
            validateProductionStorefronts({
                ...threeStores,
                storefronts: [
                    ...threeStores.storefronts,
                    { origin: 'https://delta.example.test', expectedChannelCode: 'alpha' },
                ],
            }),
        /Duplicate expected Channel/u,
    );
});

void test('release verification iterates every configured store without store-specific branches', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'production-storefronts-'));
    const configPath = path.join(directory, 'storefronts.json');
    await writeFile(configPath, JSON.stringify(threeStores));
    const calls = [];
    try {
        const result = await verifyConfiguredProductionStorefronts({
            mode: 'release',
            configPath,
            releaseId: 'release-test',
            fetchImpl: async () => {
                throw new Error('release verifier should own requests');
            },
            releaseVerifier: async options => {
                calls.push(options);
                return ['verified'];
            },
        });
        assert.deepEqual(
            calls.map(({ storefrontUrl, expectedChannelCode }) => ({ storefrontUrl, expectedChannelCode })),
            threeStores.storefronts.map(({ origin: storefrontUrl, expectedChannelCode }) => ({
                storefrontUrl,
                expectedChannelCode,
            })),
        );
        assert.equal(result.results.length, threeStores.storefronts.length);
    } finally {
        await rm(directory, { recursive: true });
    }
});

function preparedHome(store, change = {}) {
    return (
        '<html data-public-rendered="1"><head></head><body><div id="root"></div>' +
        '<script id="storefront-public-page-data" type="application/json">' +
        JSON.stringify({
            schemaVersion: 1,
            scope: {
                host: new URL(store.origin).host,
                channelCode: store.expectedChannelCode,
                priceContext: 'public',
            },
            config: { accessMode: 'LIVE' },
            request: { kind: 'home' },
            ...change,
        }) +
        '</script></body></html>'
    );
}

void test('the actual loopback HTTP transport preserves Host without requiring proxy-header trust', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'production-storefronts-'));
    t.after(() => rm(directory, { recursive: true }));
    const configPath = path.join(directory, 'stores.json');
    await writeFile(
        configPath,
        JSON.stringify({ ...threeStores, storefronts: [threeStores.storefronts[0]] }),
    );
    const paths = [];
    const server = createServer((request, response) => {
        assert.equal(request.headers.host, 'alpha.example.test');
        assert.equal(request.headers['accept-encoding'], 'identity');
        assert.ok(!request.headers.cookie && !request.headers.authorization);
        const originalUri = request.headers['x-storefront-original-uri'];
        paths.push(originalUri);
        if (originalUri === '/') {
            response.writeHead(301, { location: '/zh/' });
            response.end('Canonical language');
        } else {
            assert.equal(originalUri, '/zh/');
            response.setHeader('content-type', 'text/html');
            response.end(preparedHome(threeStores.storefronts[0]));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const prepared = await verifyConfiguredProductionStorefronts({
        mode: 'prepare',
        originUrl: 'http://127.0.0.1:3002',
        configPath,
        timeoutMs: 1000,
        localFetchImpl: (url, init) =>
            requestPreparedDocument(
                new URL(`http://127.0.0.1:${server.address().port}${url.pathname}`),
                init,
            ),
    });
    assert.equal(prepared.results.length, 1);
    assert.deepEqual(paths, ['/', '/zh/']);
});

void test('preparation exercises every real anonymous document with one budget across its canonical redirect', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'production-storefronts-'));
    t.after(() => rm(directory, { recursive: true }));
    const configPath = path.join(directory, 'stores.json');
    await writeFile(configPath, JSON.stringify(threeStores));
    const calls = [];
    const signals = new Map();
    const result = await verifyConfiguredProductionStorefronts({
        mode: 'prepare',
        originUrl: 'http://127.0.0.1:3002',
        timeoutMs: 20_000,
        configPath,
        localFetchImpl: async (url, init) => {
            assert.equal(url.href, 'http://127.0.0.1:3002/storefront/html');
            const store = threeStores.storefronts.find(s => new URL(s.origin).host === init.headers.host);
            assert.ok(store);
            assert.equal(init.headers['x-forwarded-proto'], 'https');
            assert.ok(!init.headers.cookie && !init.headers.authorization);
            assert.equal(init.redirect, 'manual');
            const originalUri = init.headers['x-storefront-original-uri'];
            calls.push({ origin: store.origin, path: originalUri });
            if (originalUri === '/') {
                signals.set(store.origin, init.signal);
                return new Response(null, { status: 301, headers: { location: '/zh/' } });
            }
            assert.equal(originalUri, '/zh/');
            assert.equal(init.signal, signals.get(store.origin), 'A redirect must not reset the budget');
            return new Response(preparedHome(store), {
                headers: {
                    'content-type': 'text/html',
                    'server-timing': 'storefront-page;dur=10921.0, storefront-render;dur=71.4',
                },
            });
        },
    });
    assert.equal(result.results.length, 3);
    assert.equal(calls.length, 6);
    assert.ok(result.results.every(r => r.serverTimings.page === 10921));
});

void test('preparation rejects non-local destinations and snapshots from a wrong or private scope', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'production-storefronts-'));
    t.after(() => rm(directory, { recursive: true }));
    const configPath = path.join(directory, 'stores.json');
    await writeFile(
        configPath,
        JSON.stringify({ ...threeStores, storefronts: [threeStores.storefronts[0]] }),
    );
    for (const originUrl of [
        'https://external.example.test',
        'http://user:pass@127.0.0.1:3002',
        'http://127.0.0.1:3002/other',
    ]) {
        await assert.rejects(
            verifyConfiguredProductionStorefronts({
                mode: 'prepare',
                originUrl,
                configPath,
                localFetchImpl: async () => {
                    throw new Error('Must not dispatch');
                },
            }),
        );
    }
    for (const change of [
        { scope: { host: 'other.example.test' } },
        { scope: { host: 'alpha.example.test', channelCode: 'wrong', priceContext: 'public' } },
        { config: { accessMode: 'PREVIEW' } },
        { request: { kind: 'product' } },
    ]) {
        await assert.rejects(
            verifyConfiguredProductionStorefronts({
                mode: 'prepare',
                originUrl: 'http://127.0.0.1:3002',
                configPath,
                localFetchImpl: async (_url, init) =>
                    init.headers['x-storefront-original-uri'] === '/'
                        ? new Response(null, { status: 301, headers: { location: '/en/' } })
                        : new Response(preparedHome(threeStores.storefronts[0], change), {
                              headers: { 'content-type': 'text/html' },
                          }),
            }),
        );
    }
});

void test('deployment prepares documents before frontend cutover and retains public release acceptance', async () => {
    const source = await readFile(
        new URL('../../../deploy/deploy-production-from-s3.sh', import.meta.url),
        'utf8',
    );
    const preparation = source.indexOf(
        '--mode prepare --origin-url http://127.0.0.1:3002 --timeout-ms 20000',
    );
    const switchFrontend = source.indexOf('storefront_pointer_changed=1', preparation);
    const acceptance = source.indexOf('--mode release', switchFrontend);
    assert.ok(preparation > 0 && switchFrontend > preparation && acceptance > switchFrontend);
    assert.doesNotMatch(source.slice(acceptance, acceptance + 100), /timeout-ms/u);
    const workflow = await readFile(
        new URL('../../../.github/workflows/production_release.yml', import.meta.url),
        'utf8',
    );
    const build = await readFile(
        new URL('../../../.github/workflows/build_production_runtime.yml', import.meta.url),
        'utf8',
    );
    assert.equal((workflow.match(/rebuild_runtime:/gu) ?? []).length, 2);
    assert.match(workflow, /force_rebuild: \$\{\{ inputs\.rebuild_runtime \|\| false \}\}/u);
    assert.match(
        build,
        /name: Reuse compiled output from the verified checks\s+if: \$\{\{ !inputs\.force_rebuild \}\}/u,
    );
    assert.match(
        build,
        /name: Build production bundles[\s\S]*?if: steps\.compiled\.outputs\.restored != 'true'/u,
    );
});

void test('public realtime readiness honors the shared request budget for every store', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'production-storefronts-'));
    t.after(() => rm(directory, { recursive: true }));
    const configPath = path.join(directory, 'storefronts.json');
    await writeFile(configPath, JSON.stringify(threeStores));

    for (const timeoutMs of [undefined, 4_000]) {
        const calls = [];
        const result = await verifyConfiguredProductionStorefronts({
            mode: 'realtime',
            configPath,
            timeoutMs,
            realtimeVerifier: async options => {
                calls.push(options);
                return { readyMs: 2_400 };
            },
        });
        assert.deepEqual(
            calls.map(call => new URL(call.url).origin),
            threeStores.storefronts.map(s => s.origin),
        );
        assert.ok(calls.every(call => call.readyTimeoutMs === (timeoutMs ?? 10_000)));
        assert.ok(calls.every(call => call.closeTimeoutMs === 2_000 && call.heartbeatTimeoutMs === 18_000));
        assert.equal(result.results.length, threeStores.storefronts.length);
    }
});

void test('public realtime failures still fail the production check', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'production-storefronts-'));
    t.after(() => rm(directory, { recursive: true }));
    const configPath = path.join(directory, 'storefronts.json');
    await writeFile(configPath, JSON.stringify(threeStores));
    for (const message of ['Timed out waiting for ready', 'HTTP 502', 'Missing heartbeat']) {
        const failure = new Error(message);
        await assert.rejects(
            verifyConfiguredProductionStorefronts({
                mode: 'realtime',
                configPath,
                realtimeVerifier: async () => {
                    throw failure;
                },
            }),
            error => error === failure,
        );
    }
});
