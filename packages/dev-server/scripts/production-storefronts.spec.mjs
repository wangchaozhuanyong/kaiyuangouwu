import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateProductionStorefronts } from '../../../deploy/production-storefronts.mjs';
import { verifyConfiguredProductionStorefronts } from '../../../deploy/verify-production-storefronts.mjs';

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
