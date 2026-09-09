#!/usr/bin/env node

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { loadProductionStorefronts } from './production-storefronts.mjs';
import { verifyProductionRelease } from './verify-production-release.mjs';
import { verifyPublicSmoke } from './verify-storefront-realtime.mjs';

async function verifyHealth(origin, fetchImpl, timeoutMs) {
    const url = new URL('/health', origin);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    assert.equal(response.status, 200, `${origin} health returned HTTP ${response.status}`);
    const body = await response.json();
    assert.equal(body?.status, 'ok', `${origin} health did not return status ok`);
    return ['public health'];
}

export async function verifyConfiguredProductionStorefronts({
    mode,
    configPath,
    releaseId = String(Date.now()),
    timeoutMs = 10_000,
    fetchImpl = globalThis.fetch,
    releaseVerifier = verifyProductionRelease,
    realtimeVerifier = verifyPublicSmoke,
} = {}) {
    assert.ok(['health', 'release', 'realtime'].includes(mode), 'mode must be health, release or realtime');
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0, 'timeoutMs must be a positive integer');
    assert.equal(typeof fetchImpl, 'function', 'fetch is unavailable');
    const config = await loadProductionStorefronts(configPath);
    const results = [];

    for (const store of config.storefronts) {
        if (mode === 'health') {
            results.push({
                origin: store.origin,
                checks: await verifyHealth(store.origin, fetchImpl, timeoutMs),
            });
            continue;
        }
        if (mode === 'release') {
            const checks = await releaseVerifier({
                storefrontUrl: store.origin,
                dashboardUrl: config.dashboardUrl,
                expectedChannelCode: store.expectedChannelCode,
                fetchImpl,
                timeoutMs,
                releaseId,
            });
            results.push({ origin: store.origin, checks });
            continue;
        }
        const result = await realtimeVerifier({
            url: new URL('/storefront-realtime/events?client=storefront', store.origin).href,
            readyTimeoutMs: 2_000,
            closeTimeoutMs: 2_000,
            heartbeatTimeoutMs: 18_000,
            releaseId,
        });
        results.push({ origin: store.origin, checks: ['storefront realtime'], result });
    }
    return { dashboardUrl: config.dashboardUrl, mode, results };
}

async function main() {
    const { values } = parseArgs({
        options: {
            mode: { type: 'string' },
            config: { type: 'string' },
            'release-id': { type: 'string', default: String(Date.now()) },
            'timeout-ms': { type: 'string', default: '10000' },
        },
        strict: true,
    });
    const result = await verifyConfiguredProductionStorefronts({
        mode: values.mode,
        configPath: values.config,
        releaseId: values['release-id'],
        timeoutMs: Number(values['timeout-ms']),
    });
    for (const store of result.results) {
        process.stdout.write(`[pass] ${store.origin} (${store.checks.join(', ')})\n`);
    }
    process.stdout.write(`PRODUCTION_STOREFRONTS_VERIFICATION ${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        process.stderr.write(`Production storefront verification failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}
