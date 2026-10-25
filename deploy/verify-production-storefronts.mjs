#!/usr/bin/env node

import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { loadProductionStorefronts } from './production-storefronts.mjs';
import { readDirectStorefront, verifyProductionRelease } from './verify-production-release.mjs';
import { verifyPublicSmoke } from './verify-storefront-realtime.mjs';

/** Node fetch replaces Host. Preserve the existing local proxy contract even
 * when forwarded-header trust is disabled. Never include credentials. */
export function requestPreparedDocument(url, { headers, signal } = {}) {
    assert.equal(url.protocol, 'http:');
    assert.equal(url.hostname, '127.0.0.1');
    assert.ok(!url.username && !url.password);
    return new Promise((resolve, reject) => {
        const request = httpRequest(
            url,
            { method: 'GET', headers: { 'accept-encoding': 'identity', ...headers }, signal },
            response => {
                const body = [204, 205, 304].includes(response.statusCode) ? null : Readable.toWeb(response);
                if (!body) response.resume();
                resolve(new Response(body, { status: response.statusCode, headers: response.headers }));
            },
        );
        request.on('error', reject);
        request.end();
    });
}

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
    originUrl,
    localFetchImpl = requestPreparedDocument,
} = {}) {
    assert.ok(['health', 'release', 'realtime', 'prepare'].includes(mode), 'Invalid verification mode');
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0, 'timeoutMs must be a positive integer');
    assert.equal(typeof fetchImpl, 'function', 'fetch is unavailable');
    const config = await loadProductionStorefronts(configPath);
    const results = [];

    if (mode === 'prepare') {
        const backend = new URL(originUrl);
        assert.equal(backend.origin, 'http://127.0.0.1:3002', 'Preparation requires the local API');
        assert.ok(
            !backend.username &&
                !backend.password &&
                backend.pathname === '/' &&
                !backend.search &&
                !backend.hash,
        );
        const deadline = Date.now() + 60_000;
        // Reuse the real anonymous document and existing cache before switching
        // frontend pointers. This is bounded preparation, never a relaxed public SLA.
        for (let start = 0; start < config.storefronts.length; start += 3) {
            results.push(
                ...(await Promise.all(
                    config.storefronts.slice(start, start + 3).map(async store => {
                        const remaining = Math.min(timeoutMs, 20_000, deadline - Date.now());
                        assert.ok(remaining > 0, 'Public document preparation budget exhausted');
                        const signal = AbortSignal.timeout(remaining);
                        const began = performance.now();
                        let serverTimings = {};
                        const html = await readDirectStorefront(
                            new URL(store.origin),
                            async (publicUrl, init) => {
                                const response = await localFetchImpl(new URL('/storefront/html', backend), {
                                    ...init,
                                    signal,
                                    headers: {
                                        host: publicUrl.host,
                                        'x-forwarded-host': publicUrl.host,
                                        'x-forwarded-proto': 'https',
                                        'x-storefront-original-uri': publicUrl.pathname + publicUrl.search,
                                    },
                                });
                                serverTimings = Object.fromEntries(
                                    [
                                        ...String(response.headers.get('server-timing') ?? '').matchAll(
                                            /storefront-([a-z-]+);dur=(\d+(?:\.\d+)?)/gu,
                                        ),
                                    ].map(match => [match[1], Number(match[2])]),
                                );
                                return response;
                            },
                            remaining,
                        );
                        assert.match(
                            html,
                            /\bdata-public-rendered=["']1["']/u,
                            'Preparation needs rendered content',
                        );
                        const embedded =
                            /<script\b[^>]*\bid=["']storefront-public-page-data["'][^>]*>([\s\S]*?)<\/script>/u.exec(
                                html,
                            );
                        let page;
                        try {
                            page = JSON.parse(embedded?.[1] ?? '');
                        } catch {
                            throw new Error('Preparation needs public snapshot data');
                        }
                        assert.equal(page.schemaVersion, 1);
                        assert.equal(page.scope?.host, new URL(store.origin).host);
                        assert.equal(page.scope?.channelCode, store.expectedChannelCode);
                        assert.equal(page.scope?.priceContext, 'public');
                        assert.equal(page.config?.accessMode, 'LIVE');
                        assert.equal(page.request?.kind, 'home');
                        return {
                            origin: store.origin,
                            checks: ['anonymous first document prepared'],
                            preparationMs: performance.now() - began,
                            serverTimings,
                        };
                    }),
                )),
            );
        }
        return { dashboardUrl: config.dashboardUrl, mode, results };
    }

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
            // Public readiness includes DNS, TLS and the CDN hop, just like the other probes.
            readyTimeoutMs: timeoutMs,
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
            'origin-url': { type: 'string' },
        },
        strict: true,
    });
    const result = await verifyConfiguredProductionStorefronts({
        mode: values.mode,
        configPath: values.config,
        releaseId: values['release-id'],
        timeoutMs: Number(values['timeout-ms']),
        originUrl: values['origin-url'],
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
