import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { verifyOriginFull, verifyPublicSmoke } from '../../../deploy/verify-storefront-realtime.mjs';

const execFileAsync = promisify(execFile);
const verifierPath = fileURLToPath(
    new URL('../../../deploy/verify-storefront-realtime.mjs', import.meta.url),
);

function waitUntil(predicate, { timeoutMs = 1_000, intervalMs = 5 } = {}) {
    const deadline = performance.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const check = () => {
            if (predicate()) {
                resolve();
                return;
            }
            if (performance.now() >= deadline) {
                reject(new Error(`Condition was not met within ${timeoutMs}ms`));
                return;
            }
            setTimeout(check, intervalMs);
        };
        check();
    });
}

async function startRealtimeFixture({
    limit = 3,
    rejectionStatus = 429,
    releaseDelayMs = 20,
    releaseDelayForProbe,
    readyData = '{"version":1,"heartbeatIntervalMs":10}',
} = {}) {
    const activeByIp = new Map();
    const acceptedProbeIds = [];
    const capacityReachedByIp = new Map();
    const sockets = new Set();
    const server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://fixture.invalid');
        if (requestUrl.pathname !== '/storefront-realtime/events') {
            response.writeHead(404).end();
            return;
        }
        const clientIp = String(request.headers['cf-connecting-ip'] ?? request.socket.remoteAddress);
        const probeId = requestUrl.searchParams.get('__sse_probe') ?? '';
        const active = activeByIp.get(clientIp) ?? 0;
        if (active >= limit) {
            response.writeHead(rejectionStatus, { connection: 'close', 'content-type': 'text/plain' });
            response.end('limited');
            return;
        }

        const nextActive = active + 1;
        activeByIp.set(clientIp, nextActive);
        acceptedProbeIds.push(probeId);
        if (nextActive === limit) {
            capacityReachedByIp.set(clientIp, (capacityReachedByIp.get(clientIp) ?? 0) + 1);
        }
        response.writeHead(200, {
            connection: 'close',
            'cache-control': 'no-store',
            'content-type': 'text/event-stream; charset=utf-8',
        });
        if (readyData != null) {
            response.write(`event: ready\ndata: ${readyData}\n\n`);
        }
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 10);
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            clearInterval(heartbeat);
            const connectionReleaseDelayMs = releaseDelayForProbe?.({ clientIp, probeId }) ?? releaseDelayMs;
            setTimeout(() => {
                const remaining = Math.max(0, (activeByIp.get(clientIp) ?? 1) - 1);
                if (remaining === 0) activeByIp.delete(clientIp);
                else activeByIp.set(clientIp, remaining);
            }, connectionReleaseDelayMs);
        };
        request.once('aborted', release);
        response.once('close', release);
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return {
        acceptedProbeIds,
        activeByIp,
        capacityReachedByIp,
        url: `http://127.0.0.1:${address.port}/storefront-realtime/events?client=storefront`,
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise((resolve, reject) =>
                server.close(error => (error ? reject(error) : resolve())),
            );
        },
    };
}

test('public smoke verifies ready and heartbeat before deterministically closing the stream', async t => {
    const fixture = await startRealtimeFixture({ releaseDelayMs: 10 });
    t.after(() => fixture.close());

    const result = await verifyPublicSmoke({
        url: fixture.url,
        readyTimeoutMs: 200,
        heartbeatTimeoutMs: 100,
        closeTimeoutMs: 200,
        releaseId: 'public-fixture',
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'public-smoke');
    assert.equal(result.status, 200);
    assert.match(result.contentType, /^text\/event-stream/iu);
    assert.ok(result.readyMs <= 200);
    assert.equal(result.readyHeartbeatIntervalMs, 10);
    assert.ok(result.heartbeatMs <= 100);
    await waitUntil(() => fixture.activeByIp.size === 0);
});

test('public smoke rejects a malformed ready payload instead of accepting only the event name', async t => {
    const fixture = await startRealtimeFixture({ readyData: 'garbage', releaseDelayMs: 10 });
    t.after(() => fixture.close());

    await assert.rejects(
        verifyPublicSmoke({
            url: fixture.url,
            readyTimeoutMs: 200,
            closeTimeoutMs: 200,
            releaseId: 'malformed-ready-fixture',
        }),
        /invalid ready event: data must be valid JSON/u,
    );

    await waitUntil(() => fixture.activeByIp.size === 0);
});

test('public smoke rejects ready metadata with an invalid heartbeat interval', async t => {
    const fixture = await startRealtimeFixture({
        readyData: '{"version":1,"heartbeatIntervalMs":0}',
        releaseDelayMs: 10,
    });
    t.after(() => fixture.close());

    await assert.rejects(
        verifyPublicSmoke({
            url: fixture.url,
            readyTimeoutMs: 200,
            closeTimeoutMs: 200,
            releaseId: 'invalid-ready-heartbeat-fixture',
        }),
        /invalid ready event: heartbeatIntervalMs must be an integer between 1 and 300000/u,
    );

    await waitUntil(() => fixture.activeByIp.size === 0);
});

test('public smoke classifies a missing ready frame as a typed timeout', async t => {
    const fixture = await startRealtimeFixture({ readyData: null, releaseDelayMs: 10 });
    t.after(() => fixture.close());

    await assert.rejects(
        verifyPublicSmoke({
            url: fixture.url,
            readyTimeoutMs: 25,
            closeTimeoutMs: 200,
            releaseId: 'missing-ready-fixture',
        }),
        error => {
            assert.equal(error.name, 'ReadyTimeoutError');
            assert.match(error.message, /timed out after 25ms waiting for ready/u);
            return true;
        },
    );

    await waitUntil(() => fixture.activeByIp.size === 0);
});

test('public smoke CLI emits one machine-readable result and exits without a curl timeout', async t => {
    const fixture = await startRealtimeFixture({ releaseDelayMs: 10 });
    t.after(() => fixture.close());

    const { stdout, stderr } = await execFileAsync(process.execPath, [
        verifierPath,
        '--mode',
        'public-smoke',
        '--url',
        fixture.url,
        '--ready-timeout-ms',
        '200',
        '--close-timeout-ms',
        '200',
        '--release-id',
        'cli-fixture',
    ]);

    assert.equal(stderr, '');
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^STOREFRONT_REALTIME_VERIFICATION /u);
    const result = JSON.parse(lines[0].replace(/^STOREFRONT_REALTIME_VERIFICATION /u, ''));
    assert.equal(result.ok, true);
    assert.equal(result.releaseId, 'cli-fixture');
    await waitUntil(() => fixture.activeByIp.size === 0);
});

test('origin full separates safe capacity, exact overload and bounded release recovery', async t => {
    const fixture = await startRealtimeFixture({ limit: 3, releaseDelayMs: 30 });
    t.after(() => fixture.close());

    const result = await verifyOriginFull({
        url: fixture.url,
        connectAddress: '127.0.0.1',
        probeIpBase: '198.51.100.40',
        connectionLimit: 3,
        safeConcurrency: 2,
        openIntervalMs: 5,
        holdOpenMs: 15,
        readyTimeoutMs: 200,
        heartbeatTimeoutMs: 100,
        releaseTimeoutMs: 500,
        recoveryPollMs: 10,
        serialCycles: 2,
        closeTimeoutMs: 200,
        releaseId: 'origin-fixture',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.capacity.accepted, 2);
    assert.deepEqual(
        {
            accepted: result.boundary.accepted,
            rejectedStatus: result.boundary.rejectedStatus,
            existingConnectionsHealthy: result.boundary.existingConnectionsHealthy,
        },
        {
            accepted: 3,
            rejectedStatus: 429,
            existingConnectionsHealthy: 3,
        },
    );
    assert.ok(result.boundary.maxReadyMs <= 200);
    assert.ok(result.boundary.maxHeartbeatMs <= 100);
    assert.equal(result.release.serialCycles, 2);
    assert.ok(result.release.rejected429 >= 1);
    assert.equal(result.release.reopenedConnections, 3);
    assert.equal(result.release.heldMs, 15);
    assert.ok(result.release.reopenMs <= 500);
    assert.equal(result.release.serialReleaseMs.length, 2);
    assert.ok((fixture.capacityReachedByIp.get('198.51.100.42') ?? 0) >= 2);
    assert.deepEqual(result.cleanup, { unclosedConnections: 0 });
    await waitUntil(() => fixture.activeByIp.size === 0);
});

test('origin full rejects a 503 overload response and still closes every accepted stream', async t => {
    const fixture = await startRealtimeFixture({ limit: 3, rejectionStatus: 503, releaseDelayMs: 10 });
    t.after(() => fixture.close());

    await assert.rejects(
        verifyOriginFull({
            url: fixture.url,
            connectAddress: '127.0.0.1',
            probeIpBase: '198.51.100.80',
            connectionLimit: 3,
            safeConcurrency: 2,
            openIntervalMs: 5,
            holdOpenMs: 10,
            readyTimeoutMs: 200,
            heartbeatTimeoutMs: 100,
            releaseTimeoutMs: 500,
            recoveryPollMs: 10,
            serialCycles: 1,
            closeTimeoutMs: 200,
            releaseId: 'failure-fixture',
        }),
        /boundary overload: expected HTTP 429, received 503/u,
    );

    await waitUntil(() => fixture.activeByIp.size === 0);
});

test('origin full fails when one released slot stays occupied even though a single reconnect succeeds', async t => {
    const releaseIp = '198.51.100.122';
    const fixture = await startRealtimeFixture({
        limit: 3,
        releaseDelayMs: 10,
        releaseDelayForProbe: ({ clientIp, probeId }) =>
            clientIp === releaseIp && probeId === 'release-fill-3' ? 500 : 10,
    });
    t.after(() => fixture.close());

    await assert.rejects(
        verifyOriginFull({
            url: fixture.url,
            connectAddress: '127.0.0.1',
            probeIpBase: '198.51.100.120',
            connectionLimit: 3,
            safeConcurrency: 2,
            openIntervalMs: 5,
            holdOpenMs: 10,
            readyTimeoutMs: 200,
            heartbeatTimeoutMs: 100,
            releaseTimeoutMs: 120,
            recoveryPollMs: 10,
            serialCycles: 1,
            closeTimeoutMs: 200,
            releaseId: 'partial-release-fixture',
        }),
        /release full recovery: could not reopen all 3 connections within 120ms/u,
    );

    assert.ok(fixture.acceptedProbeIds.some(probeId => probeId.startsWith('release-reopen-')));
    await waitUntil(() => fixture.activeByIp.size === 0);
});
