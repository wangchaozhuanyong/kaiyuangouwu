import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_URL = 'https://damatong.net/storefront-realtime/events?client=storefront';
const DEFAULT_READY_TIMEOUT_MS = 2_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const DEFAULT_CONNECTION_LIMIT = 12;
const DEFAULT_SAFE_CONCURRENCY = 8;
const DEFAULT_OPEN_INTERVAL_MS = 200;
const DEFAULT_HOLD_OPEN_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 18_000;
const DEFAULT_RELEASE_TIMEOUT_MS = 5_000;
const DEFAULT_RECOVERY_POLL_MS = 250;
const DEFAULT_SERIAL_CYCLES = 3;
const DEFAULT_PROBE_IP_BASE = '198.51.100.10';
const MAX_READY_HEARTBEAT_INTERVAL_MS = 300_000;

class ReadyTimeoutError extends Error {
    constructor(probeId, timeoutMs) {
        super(`${probeId}: timed out after ${timeoutMs}ms waiting for ready`);
        this.name = 'ReadyTimeoutError';
    }
}

function deferred() {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function positiveInteger(value, label, { allowZero = false } = {}) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
        throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
    }
    return parsed;
}

function normalizeRealtimeUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Realtime URL must use http or https');
    }
    if (url.username || url.password) {
        throw new Error('Realtime URL must not contain credentials');
    }
    if (url.pathname !== '/storefront-realtime/events') {
        throw new Error('Realtime URL must target /storefront-realtime/events');
    }
    url.hash = '';
    if (!url.searchParams.has('client')) url.searchParams.set('client', 'storefront');
    return url;
}

function phaseClientIps(baseAddress) {
    if (isIP(baseAddress) !== 4) {
        throw new Error('probeIpBase must be an IPv4 address');
    }
    const octets = baseAddress.split('.').map(Number);
    if (octets[3] > 252) {
        throw new Error('probeIpBase must leave room for three phase addresses');
    }
    return [0, 1, 2].map(offset => [...octets.slice(0, 3), octets[3] + offset].join('.'));
}

function assertLoopback(address) {
    if (!['127.0.0.1', '::1'].includes(address)) {
        throw new Error('origin-full connectAddress must be a loopback address');
    }
}

function abortError(signal) {
    const reason = signal?.reason;
    return reason instanceof Error ? reason : new Error('Realtime verification aborted');
}

function boundedDelay(durationMs, signal) {
    if (durationMs <= 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(finish, durationMs);
        signal?.addEventListener('abort', abort, { once: true });
        function finish() {
            signal?.removeEventListener('abort', abort);
            resolve();
        }
        function abort() {
            clearTimeout(timer);
            reject(abortError(signal));
        }
    });
}

function parseFrames(state, chunk, onFrame) {
    state.buffer += chunk;
    state.buffer = state.buffer.replace(/\r\n/gu, '\n');
    while (true) {
        const boundary = state.buffer.indexOf('\n\n');
        if (boundary === -1) return;
        const frame = state.buffer.slice(0, boundary);
        state.buffer = state.buffer.slice(boundary + 2);
        onFrame(frame);
    }
}

function parseFrameFields(frame) {
    let eventName = 'message';
    const data = [];
    for (const line of frame.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator === -1 ? line : line.slice(0, separator);
        const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /u, '');
        if (field === 'event') eventName = value;
        if (field === 'data') data.push(value);
    }
    return { eventName, data };
}

function inspectReadyFrame(frame) {
    const { eventName, data } = parseFrameFields(frame);
    if (eventName !== 'ready') return { kind: 'other' };
    if (data.length === 0) {
        return { kind: 'invalid', reason: 'missing data' };
    }
    try {
        const candidate = JSON.parse(data.join('\n'));
        if (candidate?.version !== 1) {
            return { kind: 'invalid', reason: 'version must equal 1' };
        }
        if (
            !Number.isInteger(candidate.heartbeatIntervalMs) ||
            candidate.heartbeatIntervalMs <= 0 ||
            candidate.heartbeatIntervalMs > MAX_READY_HEARTBEAT_INTERVAL_MS
        ) {
            return {
                kind: 'invalid',
                reason: `heartbeatIntervalMs must be an integer between 1 and ${MAX_READY_HEARTBEAT_INTERVAL_MS}`,
            };
        }
        return { kind: 'ready', heartbeatIntervalMs: candidate.heartbeatIntervalMs };
    } catch {
        return { kind: 'invalid', reason: 'data must be valid JSON' };
    }
}

function isHeartbeatFrame(frame) {
    return frame.split('\n').some(line => line.trimStart().startsWith(': heartbeat'));
}

function waitForConnectionEvent(connection, eventName, timeoutMs, label) {
    if (eventName === 'heartbeat' && connection.heartbeatAtMs != null) {
        return Promise.resolve(connection.heartbeatAtMs);
    }
    if (eventName === 'closed' && connection.closed) return Promise.resolve();
    if (connection.closed) {
        return Promise.reject(new Error(`${label}: connection closed before ${eventName}`));
    }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`${label}: timed out after ${timeoutMs}ms waiting for ${eventName}`));
        }, timeoutMs);
        const complete = value => {
            cleanup();
            resolve(value);
        };
        const closed = () => {
            cleanup();
            reject(new Error(`${label}: connection closed before ${eventName}`));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            connection.events.removeListener(eventName, complete);
            if (eventName !== 'closed') connection.events.removeListener('closed', closed);
        };
        connection.events.once(eventName, complete);
        if (eventName !== 'closed') connection.events.once('closed', closed);
    });
}

export async function openStorefrontRealtimeConnection({
    url: urlValue = DEFAULT_URL,
    connectAddress,
    clientIp,
    probeId = `${process.pid}-${Date.now()}`,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
    closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
    signal,
    rejectUnauthorized = true,
}) {
    const url = normalizeRealtimeUrl(urlValue);
    readyTimeoutMs = positiveInteger(readyTimeoutMs, 'readyTimeoutMs');
    closeTimeoutMs = positiveInteger(closeTimeoutMs, 'closeTimeoutMs');
    if (clientIp && !connectAddress) {
        throw new Error('clientIp is only allowed with an explicit loopback connectAddress');
    }
    if (connectAddress) assertLoopback(connectAddress);
    if (clientIp && isIP(clientIp) === 0) throw new Error('clientIp must be a valid IP address');
    if (signal?.aborted) throw abortError(signal);

    const requestUrl = new URL(url);
    requestUrl.searchParams.set('__sse_probe', probeId);
    const startedAt = performance.now();
    const events = new EventEmitter();
    const closed = deferred();
    const transport = requestUrl.protocol === 'https:' ? https : http;
    let response;
    let request;
    let didClose = false;
    let heartbeatAtMs;
    let closingPromise;

    const connection = {
        status: undefined,
        contentType: '',
        readyAtMs: undefined,
        readyHeartbeatIntervalMs: undefined,
        headerAtMs: undefined,
        cfRay: '',
        events,
        get closed() {
            return didClose;
        },
        get heartbeatAtMs() {
            return heartbeatAtMs;
        },
        waitForHeartbeat(timeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS) {
            timeoutMs = positiveInteger(timeoutMs, 'heartbeat timeout');
            if (heartbeatAtMs != null) {
                return heartbeatAtMs <= timeoutMs
                    ? Promise.resolve(heartbeatAtMs)
                    : Promise.reject(
                          new Error(
                              `${probeId}: heartbeat arrived after ${heartbeatAtMs}ms, exceeding ${timeoutMs}ms`,
                          ),
                      );
            }
            const remainingMs = Math.ceil(timeoutMs - (performance.now() - startedAt));
            if (remainingMs <= 0) {
                return Promise.reject(
                    new Error(`${probeId}: timed out after ${timeoutMs}ms waiting for heartbeat`),
                );
            }
            return waitForConnectionEvent(connection, 'heartbeat', remainingMs, probeId).then(
                observedAtMs => {
                    if (observedAtMs > timeoutMs) {
                        throw new Error(
                            `${probeId}: heartbeat arrived after ${observedAtMs}ms, exceeding ${timeoutMs}ms`,
                        );
                    }
                    return observedAtMs;
                },
            );
        },
        waitForClose(timeoutMs = closeTimeoutMs) {
            return waitForConnectionEvent(connection, 'closed', timeoutMs, probeId);
        },
        async close() {
            if (didClose) return;
            if (!closingPromise) {
                closingPromise = connection.waitForClose(closeTimeoutMs);
                response?.destroy();
                request?.destroy();
            }
            await closingPromise;
        },
    };

    const markClosed = () => {
        if (didClose) return;
        didClose = true;
        signal?.removeEventListener('abort', abortRequest);
        closed.resolve();
        events.emit('closed');
    };
    const abortRequest = () => {
        response?.destroy(abortError(signal));
        request?.destroy(abortError(signal));
    };
    signal?.addEventListener('abort', abortRequest, { once: true });

    try {
        await new Promise((resolve, reject) => {
            let settled = false;
            const readyTimer = setTimeout(() => {
                fail(new ReadyTimeoutError(probeId, readyTimeoutMs));
            }, readyTimeoutMs);
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(readyTimer);
                resolve();
            };
            const fail = error => {
                if (settled) return;
                settled = true;
                clearTimeout(readyTimer);
                response?.destroy();
                request?.destroy();
                reject(error);
            };
            const headers = {
                accept: 'text/event-stream',
                'cache-control': 'no-store',
                connection: 'close',
                host: requestUrl.host,
                ...(clientIp ? { 'cf-connecting-ip': clientIp } : {}),
            };
            request = transport.request(
                {
                    protocol: requestUrl.protocol,
                    hostname: connectAddress ?? requestUrl.hostname,
                    port: requestUrl.port || undefined,
                    path: `${requestUrl.pathname}${requestUrl.search}`,
                    method: 'GET',
                    headers,
                    agent: false,
                    ...(requestUrl.protocol === 'https:'
                        ? { servername: requestUrl.hostname, rejectUnauthorized }
                        : {}),
                },
                incoming => {
                    response = incoming;
                    connection.status = incoming.statusCode ?? 0;
                    connection.contentType = String(incoming.headers['content-type'] ?? '');
                    connection.cfRay = String(incoming.headers['cf-ray'] ?? '');
                    connection.headerAtMs = Math.round(performance.now() - startedAt);
                    incoming.once('close', markClosed);
                    incoming.once('end', markClosed);
                    incoming.on('error', error => {
                        if (!settled) fail(new Error(`${probeId}: response failed: ${error.message}`));
                    });

                    if (connection.status !== 200) {
                        incoming.resume();
                        finish();
                        return;
                    }
                    if (!/^text\/event-stream(?:;|$)/iu.test(connection.contentType)) {
                        fail(
                            new Error(
                                `${probeId}: expected text/event-stream, received ${connection.contentType || '(missing)'}`,
                            ),
                        );
                        return;
                    }
                    incoming.setEncoding('utf8');
                    const parser = { buffer: '' };
                    incoming.on('data', chunk => {
                        parseFrames(parser, chunk, frame => {
                            const readyFrame = inspectReadyFrame(frame);
                            if (readyFrame.kind === 'invalid') {
                                fail(new Error(`${probeId}: invalid ready event: ${readyFrame.reason}`));
                                return;
                            }
                            if (readyFrame.kind === 'ready' && connection.readyAtMs == null) {
                                connection.readyAtMs = Math.round(performance.now() - startedAt);
                                connection.readyHeartbeatIntervalMs = readyFrame.heartbeatIntervalMs;
                                if (connection.readyAtMs > readyTimeoutMs) {
                                    fail(
                                        new Error(
                                            `${probeId}: ready arrived after ${connection.readyAtMs}ms, exceeding ${readyTimeoutMs}ms`,
                                        ),
                                    );
                                    return;
                                }
                                events.emit('ready', connection.readyAtMs);
                                finish();
                            }
                            if (isHeartbeatFrame(frame)) {
                                if (heartbeatAtMs == null) {
                                    heartbeatAtMs = Math.round(performance.now() - startedAt);
                                    events.emit('heartbeat', heartbeatAtMs);
                                }
                            }
                        });
                    });
                    incoming.once('close', () => {
                        if (!settled) fail(new Error(`${probeId}: connection closed before ready`));
                    });
                    incoming.once('end', () => {
                        if (!settled) fail(new Error(`${probeId}: response ended before ready`));
                    });
                },
            );
            request.once('error', error => {
                if (!settled) fail(new Error(`${probeId}: request failed: ${error.message}`));
                else markClosed();
            });
            request.once('close', () => {
                if (!response) markClosed();
            });
            request.end();
        });
        return connection;
    } catch (error) {
        const closedCleanly = await Promise.race([
            closed.promise.then(() => true),
            boundedDelay(closeTimeoutMs).then(() => false),
        ]);
        if (!closedCleanly) {
            throw new AggregateError(
                [error, new Error(`Connection cleanup timed out after ${closeTimeoutMs}ms`)],
                error.message,
                { cause: error },
            );
        }
        throw error;
    }
}

function asError(value) {
    return value instanceof Error ? value : new Error(String(value));
}

async function closeConnections(connections, primaryError) {
    const uniqueConnections = [...new Set(connections.filter(Boolean))];
    const results = await Promise.allSettled(uniqueConnections.map(connection => connection.close()));
    const cleanupErrors = results
        .filter(result => result.status === 'rejected')
        .map(result => asError(result.reason));
    if (primaryError) {
        const original = asError(primaryError);
        if (cleanupErrors.length) {
            throw new AggregateError(
                [original, ...cleanupErrors],
                `${original.message}; ${cleanupErrors.length} connection cleanup operation(s) also failed`,
                { cause: original },
            );
        }
        throw original;
    }
    if (cleanupErrors.length) {
        throw new AggregateError(
            cleanupErrors,
            `${cleanupErrors.length} connection cleanup operation(s) failed`,
        );
    }
}

async function withConnectionCleanup(getConnections, operation) {
    let result;
    let primaryError;
    try {
        result = await operation();
    } catch (error) {
        primaryError = error;
    }
    await closeConnections(getConnections(), primaryError);
    return result;
}

function expectAccepted(connection, label) {
    if (connection.status >= 500) {
        throw new Error(`${label}: received unexpected HTTP ${connection.status}`);
    }
    if (connection.status !== 200) {
        throw new Error(`${label}: expected HTTP 200, received ${connection.status}`);
    }
    if (connection.readyAtMs == null) {
        throw new Error(`${label}: missing ready event`);
    }
}

async function openAcceptedConnections({ count, label, openIntervalMs, signal, connectionOptions }) {
    const connections = [];
    try {
        for (let index = 0; index < count; index++) {
            if (index > 0) await boundedDelay(openIntervalMs, signal);
            const connection = await openStorefrontRealtimeConnection({
                ...connectionOptions,
                probeId: `${label}-${index + 1}`,
                signal,
            });
            connections.push(connection);
            expectAccepted(connection, `${label}-${index + 1}`);
        }
        return connections;
    } catch (error) {
        await closeConnections(connections, error);
        throw new Error('Unreachable after connection cleanup');
    }
}

async function assertConnectionsRemainOpen(connections, durationMs, signal, label) {
    const alreadyClosed = connections.findIndex(connection => connection.closed);
    if (alreadyClosed !== -1) {
        throw new Error(`${label}-${alreadyClosed + 1}: connection closed before hold window`);
    }
    const watchers = connections.map((connection, index) => {
        let listener;
        const promise = new Promise((_resolve, reject) => {
            listener = () => reject(new Error(`${label}-${index + 1}: connection closed during hold window`));
            connection.events.once('closed', listener);
        });
        return { connection, listener, promise };
    });
    try {
        await Promise.race([boundedDelay(durationMs, signal), ...watchers.map(watcher => watcher.promise)]);
    } finally {
        for (const watcher of watchers) {
            watcher.connection.events.removeListener('closed', watcher.listener);
            watcher.promise.catch(() => undefined);
        }
    }
}

async function waitForRecovery({
    connectionOptions,
    releaseTimeoutMs,
    recoveryPollMs,
    label = 'release-recovery',
    signal,
}) {
    const startedAt = performance.now();
    const deadline = startedAt + releaseTimeoutMs;
    let attempts = 0;
    let rejected429 = 0;
    while (performance.now() < deadline) {
        attempts++;
        const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
        let connection;
        const outcome = await withConnectionCleanup(
            () => [connection],
            async () => {
                connection = await openStorefrontRealtimeConnection({
                    ...connectionOptions,
                    probeId: `${label}-${attempts}`,
                    readyTimeoutMs: Math.min(connectionOptions.readyTimeoutMs, remainingMs),
                    signal,
                });
                if (connection.status === 200) {
                    expectAccepted(connection, label);
                    return 'accepted';
                }
                if (connection.status >= 500) {
                    throw new Error(`${label}: received unexpected HTTP ${connection.status}`);
                }
                if (connection.status !== 429) {
                    throw new Error(`${label}: expected HTTP 200 or 429, received ${connection.status}`);
                }
                return 'limited';
            },
        );
        if (outcome === 'accepted') {
            return {
                attempts,
                rejected429,
                releaseMs: Math.round(performance.now() - startedAt),
            };
        }
        if (outcome === 'limited') {
            rejected429++;
        } else {
            throw new Error(`${label}: verifier returned an unknown recovery outcome`);
        }
        const remainingAfterRequest = deadline - performance.now();
        if (remainingAfterRequest > 0) {
            await boundedDelay(Math.min(recoveryPollMs, remainingAfterRequest), signal);
        }
    }
    throw new Error(`${label}: no HTTP 200 within ${releaseTimeoutMs}ms`);
}

async function waitForFullCapacityRecovery({
    connectionOptions,
    connectionLimit,
    openIntervalMs,
    holdOpenMs,
    releaseTimeoutMs,
    recoveryPollMs,
    signal,
}) {
    const startedAt = performance.now();
    const deadline = startedAt + releaseTimeoutMs;
    let attempts = 0;
    let rejected429 = 0;
    while (performance.now() < deadline) {
        attempts++;
        const connections = [];
        const outcome = await withConnectionCleanup(
            () => connections,
            async () => {
                for (let index = 0; index < connectionLimit; index++) {
                    const remainingBeforeOpen = deadline - performance.now();
                    if (remainingBeforeOpen <= 0) return { state: 'deadline' };
                    if (index > 0) {
                        await boundedDelay(Math.min(openIntervalMs, remainingBeforeOpen), signal);
                    }
                    const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
                    let connection;
                    try {
                        connection = await openStorefrontRealtimeConnection({
                            ...connectionOptions,
                            probeId: `release-reopen-${attempts}-${index + 1}`,
                            readyTimeoutMs: Math.min(connectionOptions.readyTimeoutMs, remainingMs),
                            signal,
                        });
                    } catch (error) {
                        if (performance.now() >= deadline && error instanceof ReadyTimeoutError) {
                            return { state: 'deadline' };
                        }
                        throw error;
                    }
                    connections.push(connection);
                    if (connection.status === 429) {
                        rejected429++;
                        return { state: 'limited' };
                    }
                    if (connection.status >= 500) {
                        throw new Error(
                            `release full recovery: received unexpected HTTP ${connection.status}`,
                        );
                    }
                    if (connection.status !== 200) {
                        throw new Error(
                            `release full recovery: expected HTTP 200 or 429, received ${connection.status}`,
                        );
                    }
                    expectAccepted(connection, `release-reopen-${index + 1}`);
                }
                const reopenMs = Math.round(performance.now() - startedAt);
                if (reopenMs > releaseTimeoutMs) return { state: 'deadline' };
                await assertConnectionsRemainOpen(connections, holdOpenMs, signal, 'release-reopen');
                return {
                    state: 'accepted',
                    reopenMs,
                    maxReadyMs: Math.max(...connections.map(connection => connection.readyAtMs)),
                };
            },
        );
        if (outcome.state === 'accepted') {
            return {
                attempts,
                rejected429,
                reopenMs: outcome.reopenMs,
                reopenedConnections: connectionLimit,
                heldMs: holdOpenMs,
                maxReadyMs: outcome.maxReadyMs,
            };
        }
        if (outcome.state === 'deadline') break;
        const remainingAfterAttempt = deadline - performance.now();
        if (remainingAfterAttempt > 0) {
            await boundedDelay(Math.min(recoveryPollMs, remainingAfterAttempt), signal);
        }
    }
    throw new Error(
        `release full recovery: could not reopen all ${connectionLimit} connections within ${releaseTimeoutMs}ms`,
    );
}

export async function verifyPublicSmoke({
    url = DEFAULT_URL,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
    heartbeatTimeoutMs = 0,
    closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
    releaseId = String(Date.now()),
    signal,
    rejectUnauthorized = true,
} = {}) {
    const connection = await openStorefrontRealtimeConnection({
        url,
        readyTimeoutMs,
        closeTimeoutMs,
        probeId: `public-smoke-${releaseId}`,
        signal,
        rejectUnauthorized,
    });
    return withConnectionCleanup(
        () => [connection],
        async () => {
            expectAccepted(connection, 'public smoke');
            const heartbeatAtMs = heartbeatTimeoutMs
                ? await connection.waitForHeartbeat(positiveInteger(heartbeatTimeoutMs, 'heartbeatTimeoutMs'))
                : undefined;
            return {
                ok: true,
                mode: 'public-smoke',
                releaseId,
                status: connection.status,
                contentType: connection.contentType,
                readyMs: connection.readyAtMs,
                readyHeartbeatIntervalMs: connection.readyHeartbeatIntervalMs,
                ...(heartbeatAtMs == null ? {} : { heartbeatMs: heartbeatAtMs }),
                cfRay: connection.cfRay || null,
            };
        },
    );
}

export async function verifyOriginFull({
    url = DEFAULT_URL,
    connectAddress = '127.0.0.1',
    probeIpBase = DEFAULT_PROBE_IP_BASE,
    connectionLimit = DEFAULT_CONNECTION_LIMIT,
    safeConcurrency = DEFAULT_SAFE_CONCURRENCY,
    openIntervalMs = DEFAULT_OPEN_INTERVAL_MS,
    holdOpenMs = DEFAULT_HOLD_OPEN_MS,
    readyTimeoutMs = 3_000,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    releaseTimeoutMs = DEFAULT_RELEASE_TIMEOUT_MS,
    recoveryPollMs = DEFAULT_RECOVERY_POLL_MS,
    serialCycles = DEFAULT_SERIAL_CYCLES,
    closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
    releaseId = String(Date.now()),
    signal,
    rejectUnauthorized = true,
} = {}) {
    assertLoopback(connectAddress);
    connectionLimit = positiveInteger(connectionLimit, 'connectionLimit');
    safeConcurrency = positiveInteger(safeConcurrency, 'safeConcurrency');
    openIntervalMs = positiveInteger(openIntervalMs, 'openIntervalMs', { allowZero: true });
    holdOpenMs = positiveInteger(holdOpenMs, 'holdOpenMs');
    readyTimeoutMs = positiveInteger(readyTimeoutMs, 'readyTimeoutMs');
    heartbeatTimeoutMs = positiveInteger(heartbeatTimeoutMs, 'heartbeatTimeoutMs');
    releaseTimeoutMs = positiveInteger(releaseTimeoutMs, 'releaseTimeoutMs');
    recoveryPollMs = positiveInteger(recoveryPollMs, 'recoveryPollMs');
    serialCycles = positiveInteger(serialCycles, 'serialCycles');
    closeTimeoutMs = positiveInteger(closeTimeoutMs, 'closeTimeoutMs');
    if (safeConcurrency >= connectionLimit) {
        throw new Error('safeConcurrency must be less than connectionLimit');
    }
    const [capacityIp, boundaryIp, releaseIp] = phaseClientIps(probeIpBase);
    const baseConnectionOptions = {
        url,
        connectAddress,
        readyTimeoutMs,
        closeTimeoutMs,
        rejectUnauthorized,
    };

    let capacityConnections = [];
    const capacityStartedAt = performance.now();
    await withConnectionCleanup(
        () => capacityConnections,
        async () => {
            capacityConnections = await openAcceptedConnections({
                count: safeConcurrency,
                label: 'safe-capacity',
                openIntervalMs,
                signal,
                connectionOptions: { ...baseConnectionOptions, clientIp: capacityIp },
            });
            await assertConnectionsRemainOpen(capacityConnections, holdOpenMs, signal, 'safe-capacity');
        },
    );
    const capacity = {
        accepted: safeConcurrency,
        heldMs: holdOpenMs,
        maxReadyMs: Math.max(...capacityConnections.map(connection => connection.readyAtMs)),
        durationMs: Math.round(performance.now() - capacityStartedAt),
    };

    let boundaryConnections = [];
    let overloadConnection;
    await withConnectionCleanup(
        () => [...boundaryConnections, overloadConnection],
        async () => {
            boundaryConnections = await openAcceptedConnections({
                count: connectionLimit,
                label: 'boundary',
                openIntervalMs,
                signal,
                connectionOptions: { ...baseConnectionOptions, clientIp: boundaryIp },
            });
            await boundedDelay(openIntervalMs, signal);
            overloadConnection = await openStorefrontRealtimeConnection({
                ...baseConnectionOptions,
                clientIp: boundaryIp,
                probeId: 'boundary-overload',
                signal,
            });
            if (overloadConnection.status !== 429) {
                throw new Error(
                    `boundary overload: expected HTTP 429, received ${overloadConnection.status}`,
                );
            }
            await Promise.all(
                boundaryConnections.map(connection => connection.waitForHeartbeat(heartbeatTimeoutMs)),
            );
            if (boundaryConnections.some(connection => connection.closed)) {
                throw new Error('boundary: an accepted connection closed after the overload probe');
            }
        },
    );
    const boundary = {
        accepted: connectionLimit,
        rejectedStatus: 429,
        existingConnectionsHealthy: connectionLimit,
        maxReadyMs: Math.max(...boundaryConnections.map(connection => connection.readyAtMs)),
        maxHeartbeatMs: Math.max(...boundaryConnections.map(connection => connection.heartbeatAtMs)),
    };

    let releaseConnections = [];
    await withConnectionCleanup(
        () => releaseConnections,
        async () => {
            releaseConnections = await openAcceptedConnections({
                count: connectionLimit,
                label: 'release-fill',
                openIntervalMs,
                signal,
                connectionOptions: { ...baseConnectionOptions, clientIp: releaseIp },
            });
        },
    );
    const fullRecovery = await waitForFullCapacityRecovery({
        connectionOptions: { ...baseConnectionOptions, clientIp: releaseIp },
        connectionLimit,
        openIntervalMs,
        holdOpenMs,
        releaseTimeoutMs,
        recoveryPollMs,
        signal,
    });
    const serialReleaseMs = [];
    for (let index = 0; index < serialCycles; index++) {
        const serialRecovery = await waitForRecovery({
            connectionOptions: { ...baseConnectionOptions, clientIp: releaseIp },
            releaseTimeoutMs,
            recoveryPollMs,
            label: `release-serial-${index + 1}`,
            signal,
        });
        serialReleaseMs.push(serialRecovery.releaseMs);
    }

    return {
        ok: true,
        mode: 'origin-full',
        releaseId,
        limit: connectionLimit,
        capacity,
        boundary,
        release: {
            ...fullRecovery,
            filledConnections: connectionLimit,
            maxFillReadyMs: Math.max(...releaseConnections.map(connection => connection.readyAtMs)),
            serialCycles,
            serialReleaseMs,
        },
        cleanup: { unclosedConnections: 0 },
    };
}

function cliOptions(values) {
    const common = {
        url: values.url,
        readyTimeoutMs: positiveInteger(values['ready-timeout-ms'], 'ready-timeout-ms'),
        closeTimeoutMs: positiveInteger(values['close-timeout-ms'], 'close-timeout-ms'),
        releaseId: values['release-id'],
    };
    if (values.mode === 'public-smoke') {
        return {
            ...common,
            heartbeatTimeoutMs: positiveInteger(values['heartbeat-timeout-ms'], 'heartbeat-timeout-ms', {
                allowZero: true,
            }),
        };
    }
    if (values.mode !== 'origin-full') {
        throw new Error('mode must be public-smoke or origin-full');
    }
    if (!values['connect-address']) {
        throw new Error('origin-full mode requires --connect-address 127.0.0.1');
    }
    return {
        ...common,
        connectAddress: values['connect-address'],
        probeIpBase: values['probe-ip-base'],
        connectionLimit: positiveInteger(values['connection-limit'], 'connection-limit'),
        safeConcurrency: positiveInteger(values['safe-concurrency'], 'safe-concurrency'),
        openIntervalMs: positiveInteger(values['open-interval-ms'], 'open-interval-ms', { allowZero: true }),
        holdOpenMs: positiveInteger(values['hold-open-ms'], 'hold-open-ms'),
        heartbeatTimeoutMs:
            Number(values['heartbeat-timeout-ms']) === 0
                ? DEFAULT_HEARTBEAT_TIMEOUT_MS
                : positiveInteger(values['heartbeat-timeout-ms'], 'heartbeat-timeout-ms'),
        releaseTimeoutMs: positiveInteger(values['release-timeout-ms'], 'release-timeout-ms'),
        recoveryPollMs: positiveInteger(values['recovery-poll-ms'], 'recovery-poll-ms'),
        serialCycles: positiveInteger(values['serial-cycles'], 'serial-cycles'),
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            mode: { type: 'string' },
            url: { type: 'string', default: DEFAULT_URL },
            'release-id': { type: 'string', default: String(Date.now()) },
            'connect-address': { type: 'string' },
            'probe-ip-base': { type: 'string', default: DEFAULT_PROBE_IP_BASE },
            'connection-limit': { type: 'string', default: String(DEFAULT_CONNECTION_LIMIT) },
            'safe-concurrency': { type: 'string', default: String(DEFAULT_SAFE_CONCURRENCY) },
            'open-interval-ms': { type: 'string', default: String(DEFAULT_OPEN_INTERVAL_MS) },
            'hold-open-ms': { type: 'string', default: String(DEFAULT_HOLD_OPEN_MS) },
            'ready-timeout-ms': { type: 'string', default: String(DEFAULT_READY_TIMEOUT_MS) },
            'heartbeat-timeout-ms': { type: 'string', default: '0' },
            'release-timeout-ms': { type: 'string', default: String(DEFAULT_RELEASE_TIMEOUT_MS) },
            'recovery-poll-ms': { type: 'string', default: String(DEFAULT_RECOVERY_POLL_MS) },
            'serial-cycles': { type: 'string', default: String(DEFAULT_SERIAL_CYCLES) },
            'close-timeout-ms': { type: 'string', default: String(DEFAULT_CLOSE_TIMEOUT_MS) },
        },
        strict: true,
    });
    if (!values.mode) {
        throw new Error(
            'Usage: node deploy/verify-storefront-realtime.mjs --mode <public-smoke|origin-full>',
        );
    }
    const abortController = new AbortController();
    const abort = () => abortController.abort(new Error('Realtime verification interrupted'));
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
    try {
        const options = { ...cliOptions(values), signal: abortController.signal };
        const result =
            values.mode === 'public-smoke'
                ? await verifyPublicSmoke(options)
                : await verifyOriginFull(options);
        process.stdout.write(`STOREFRONT_REALTIME_VERIFICATION ${JSON.stringify(result)}\n`);
    } finally {
        process.removeListener('SIGINT', abort);
        process.removeListener('SIGTERM', abort);
    }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch(error => {
        process.stderr.write(
            `STOREFRONT_REALTIME_VERIFICATION ${JSON.stringify({ ok: false, error: error.message })}\n`,
        );
        process.exitCode = 1;
    });
}
