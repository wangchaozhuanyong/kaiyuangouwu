import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { diagnoseIcloudRelay, ICLOUD_DIAGNOSTIC_URL } from './icloud-relay-diagnostic.mjs';

const username = 'fixture-admin-private';
const password = '  fixture-password-private  ';
const sessionToken = 'fixture-session-private';
const channelToken = index => `fixture-channel-token-private-${index}`;
const privateMarkers = [
    username,
    password.trim(),
    sessionToken,
    'fixture-email-private@example.invalid',
    'fixture-query-code-private',
    'fixture-channel-code-private',
    'EVIL_UPPERCASE_SECRET',
    'fixture-header-private',
    'fixture-error-private',
    'fixture-cookie-private',
];
const names = [
    'IcloudRelayPrimaryMinimal',
    'IcloudRelayAliasMinimal',
    'IcloudRelayPrimaryFull',
    'IcloudRelayAliasFull',
];
const operations = ['primary_minimal', 'alias_minimal', 'primary_full', 'alias_full'];
const credentials = { username: ` ${username} `, password };
function assertNoSecrets(receipt) {
    const encoded = JSON.stringify(receipt);
    for (const marker of privateMarkers) assert.ok(!encoded.includes(marker));
    assert.doesNotMatch(encoded, /fixture-channel-token-private/u);
    assert.ok(Buffer.byteLength(encoded) <= 12 * 1024);
}
function json(response, payload, extraHeaders = {}, status = 200) {
    response.writeHead(status, {
        'content-type': 'application/json',
        'x-private-diagnostic': 'fixture-header-private',
        'set-cookie': 'session=fixture-cookie-private; HttpOnly',
        ...extraHeaders,
    });
    response.end(JSON.stringify(payload));
}
function login(response, count = 1, overrides = {}) {
    json(
        response,
        {
            data: {
                login: {
                    __typename: 'CurrentUser',
                    id: 'fixture-user-id-private',
                    channels: Array.from({ length: count }, (_, index) => ({
                        code: index === 0 ? '__default_channel__' : `fixture-channel-code-private-${index}`,
                        token: channelToken(index),
                    })),
                    ...overrides,
                },
            },
        },
        { 'vendure-auth-token': sessionToken },
    );
}
function normal(response, entry) {
    if (entry.operation === 'IcloudRelayDiagnosticLogin') return login(response);
    const field = entry.operation.includes('Primary') ? 'icloudPrimaryAccounts' : 'icloudVirtualEmails';
    json(response, {
        data: {
            [field]: [
                {
                    id: 'fixture-row-id-private',
                    email: 'fixture-email-private@example.invalid',
                    buyerQueryCode: 'fixture-query-code-private',
                },
            ],
        },
    });
}
async function fixture(t, handler) {
    const entries = [];
    let active = 0;
    let maximumActive = 0;
    const server = createServer((incomingRequest, response) => {
        const chunks = [];
        incomingRequest.on('data', chunk => chunks.push(chunk));
        incomingRequest.on('end', () => {
            const document = JSON.parse(Buffer.concat(chunks).toString());
            const entry = {
                ...document,
                method: incomingRequest.method,
                headers: incomingRequest.headers,
                operation: document.query.match(/(?:mutation|query)\s+(\w+)/u)?.[1],
            };
            entries.push(entry);
            active++;
            maximumActive = Math.max(maximumActive, active);
            let finished = false;
            const done = () => {
                if (!finished) {
                    active--;
                    finished = true;
                }
            };
            response.once('finish', done);
            response.once('close', done);
            Promise.resolve(handler(entry, response, incomingRequest)).catch(() => response.destroy());
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/admin-api`;
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const request = (url, options) => {
        assert.equal(url, 'http://127.0.0.1:3002/admin-api');
        assert.equal(url, ICLOUD_DIAGNOSTIC_URL);
        assert.equal(options.redirect, 'error');
        assert.equal(options.method, 'POST');
        return fetch(endpoint, options);
    };
    return { entries, request, maximumActive: () => maximumActive };
}
const probes = receipt => receipt.channels.flatMap(channel => channel.probes);

test('uses existing login and fixed read contracts, preserves password bytes and queries channels serially', async t => {
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === 'IcloudRelayDiagnosticLogin') return login(response, 2);
        normal(response, entry);
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(result.category, 'OK');
    assert.equal(result.channelCount, 2);
    assert.deepEqual(
        result.channels.map(channel => [channel.channelIndex, channel.isDefaultChannel]),
        [
            [1, true],
            [2, false],
        ],
    );
    assert.deepEqual(
        api.entries.map(entry => entry.operation),
        ['IcloudRelayDiagnosticLogin', ...names, ...names],
    );
    assert.equal(api.maximumActive(), 1);
    assert.equal(api.entries[0].variables.username, username);
    assert.equal(api.entries[0].variables.password, password);
    assert.match(api.entries[0].query, /rememberMe: false/u);
    assert.ok(!api.entries[0].headers.authorization);
    assert.equal(api.entries.filter(entry => entry.query.startsWith('mutation')).length, 1);
    for (const [index, entry] of api.entries.slice(1).entries()) {
        assert.equal(entry.headers.authorization, `Bearer ${sessionToken}`);
        assert.equal(entry.headers['vendure-token'], channelToken(Math.floor(index / 4)));
        assert.deepEqual(entry.variables, {});
        assert.ok(entry.query.startsWith('query '));
    }
    assert.deepEqual(
        probes(result).map(probe => probe.operation),
        [...operations, ...operations],
    );
    assert.ok(probes(result).every(probe => probe.count === 1 && probe.errorCount === 0));
    assertNoSecrets(result);

    // Consumer contract pinned to ID f2ae47fb; also validate against this Vendure schema.
    const schema = await readFile(
        new URL('../packages/icloud-relay-plugin/src/api/api-extensions.ts', import.meta.url),
        'utf8',
    );
    const fieldSet = name =>
        new Set(
            [
                ...schema
                    .match(new RegExp(`type ${name} implements Node \\{([\\s\\S]*?)\\}`, 'u'))[1]
                    .matchAll(/^\s*(\w+):/gmu),
            ].map(match => match[1]),
        );
    const requested = entry =>
        entry.query
            .match(/(?:icloudPrimaryAccounts|icloudVirtualEmails)\s*\{([^}]+)\}/u)[1]
            .trim()
            .split(/\s+/u);
    const primary = `id createdAt updatedAt email note status imapHost imapPort masterQueryCode
        codeExpiresAt codeResetIntervalDays remainingDays lastQueriedAt lastQueriedIp lastSyncedAt
        lastSyncError virtualEmailCount`.split(/\s+/u);
    const alias = `id createdAt updatedAt primaryAccountId primaryAccountEmail aliasEmail note status
        buyerQueryCode codeExpiresAt codeResetIntervalDays remainingDays lastQueriedAt lastQueriedIp
        mailCount lastMailReceivedAt`.split(/\s+/u);
    assert.deepEqual(requested(api.entries[1]), ['id']);
    assert.deepEqual(requested(api.entries[2]), ['id']);
    assert.deepEqual(requested(api.entries[3]), primary);
    assert.deepEqual(requested(api.entries[4]), alias);
    assert.ok(primary.every(field => fieldSet('IcloudPrimaryAccountView').has(field)));
    assert.ok(alias.every(field => fieldSet('IcloudVirtualEmailView').has(field)));
});

test('keeps four failed probe receipts and separates HTTP, MIME, JSON and envelope failures', async t => {
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === 'IcloudRelayDiagnosticLogin') return login(response);
        const index = names.indexOf(entry.operation);
        if (index === 0) return json(response, { message: 'fixture-error-private' }, {}, 502);
        if (index === 1) {
            response.writeHead(200, { 'content-type': 'text/html; fixture-header-private' });
            return response.end('<html>fixture-error-private</html>');
        }
        if (index === 2) {
            response.writeHead(200, { 'content-type': 'application/json' });
            return response.end('{fixture-error-private');
        }
        json(response, { data: null });
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(result.category, 'PARTIAL_FAILURE');
    assert.deepEqual(
        probes(result).map(probe => probe.category),
        ['HTTP_ERROR', 'UNEXPECTED_CONTENT_TYPE', 'INVALID_JSON', 'INVALID_ENVELOPE'],
    );
    assert.deepEqual(
        probes(result).map(probe => probe.status),
        [502, 200, 200, 200],
    );
    assert.deepEqual(
        probes(result).map(probe => probe.contentType),
        ['json', 'html', 'json', 'json'],
    );
    assert.equal(api.entries.length, 5);
    assertNoSecrets(result);
});

test('sanitizes GraphQL extensions and paths and never treats partial data as success', async t => {
    const cases = [
        { code: 'FORBIDDEN', path: ['icloudPrimaryAccounts', 0, 'id'] },
        { code: 'GRAPHQL_VALIDATION_FAILED', path: ['icloudVirtualEmails', 9999, 'status'] },
        { code: 'EVIL_UPPERCASE_SECRET', path: ['fixture-error-private'] },
        { code: 'INTERNAL_SERVER_ERROR', path: ['icloudVirtualEmails', -1, 'buyerQueryCode'] },
    ];
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === 'IcloudRelayDiagnosticLogin') return login(response);
        const value = cases[names.indexOf(entry.operation)];
        json(response, {
            data: { icloudPrimaryAccounts: [{ email: privateMarkers[3] }] },
            errors: Array.from({ length: 12 }, () => ({
                message: 'fixture-error-private',
                stack: 'fixture-error-private',
                extensions: { code: value.code, private: 'fixture-header-private' },
                path: value.path,
            })),
        });
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.deepEqual(
        probes(result).map(probe => probe.category),
        ['GRAPHQL_AUTHORIZATION', 'GRAPHQL_SCHEMA', 'GRAPHQL_ERROR', 'GRAPHQL_ERROR'],
    );
    assert.deepEqual(
        probes(result).map(probe => probe.code),
        ['FORBIDDEN', 'GRAPHQL_VALIDATION_FAILED', 'UNKNOWN', 'INTERNAL_SERVER_ERROR'],
    );
    assert.deepEqual(
        probes(result).map(probe => probe.path),
        [cases[0].path, cases[1].path, null, null],
    );
    assert.ok(probes(result).every(probe => probe.errorCount === 12 && probe.count === null));
    assertNoSecrets(result);
});

test('rejects malformed GraphQL envelopes, error arrays and list roots', async t => {
    const payloads = [
        [],
        { errors: 'fixture-error-private', data: {} },
        { errors: ['fixture-error-private'], data: {} },
        { data: { icloudVirtualEmails: [{ id: 1 }, null] } },
    ];
    const api = await fixture(t, (entry, response) =>
        entry.operation === 'IcloudRelayDiagnosticLogin'
            ? login(response)
            : json(response, payloads[names.indexOf(entry.operation)]),
    );
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.ok(probes(result).every(probe => probe.category === 'INVALID_ENVELOPE'));
    assertNoSecrets(result);
});

test('stops after ordinary login rejects password or 2FA without an authentication bypass', async t => {
    const api = await fixture(t, (_entry, response) =>
        json(response, {
            data: {
                login: {
                    __typename: 'InvalidCredentialsError',
                    message: 'fixture-error-private',
                },
            },
        }),
    );
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(result.category, 'LOGIN_REJECTED');
    assert.equal(result.login.category, 'LOGIN_REJECTED');
    assert.equal(api.entries.length, 1);
    assert.deepEqual(result.channels, []);
    assertNoSecrets(result);
});

test('does not probe after failed login transport or protocol', async t => {
    for (const mode of ['http', 'graphql', 'token', 'channels'])
        await t.test(mode, async child => {
            const api = await fixture(child, (_entry, response) => {
                if (mode === 'http') return json(response, { secret: privateMarkers[3] }, {}, 403);
                if (mode === 'graphql')
                    return json(response, {
                        errors: [{ message: privateMarkers[3], extensions: { code: 'UNAUTHENTICATED' } }],
                    });
                if (mode === 'token')
                    return json(response, { data: { login: { __typename: 'CurrentUser', channels: [] } } });
                return login(response, 1, {
                    channels: [{ code: '__default_channel__', token: 'bad\u0000token' }],
                });
            });
            const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
            assert.equal(result.category, 'LOGIN_FAILED');
            assert.equal(api.entries.length, 1);
            assert.deepEqual(result.channels, []);
            assertNoSecrets(result);
        });
});

test('refuses excessive channel coverage instead of silently testing a subset', async t => {
    const api = await fixture(t, (_entry, response) => login(response, 17));
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(result.category, 'CHANNEL_LIMIT');
    assert.equal(result.channelsTruncated, true);
    assert.equal(result.channelCount, 0);
    assert.equal(api.entries.length, 1);
    assert.deepEqual(result.channels, []);
    assertNoSecrets(result);
});

test('reports real connection loss but continues later read probes once without retries', async t => {
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === names[0]) return response.destroy(new Error('fixture-error-private'));
        normal(response, entry);
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(probes(result)[0].category, 'REQUEST_FAILED');
    assert.deepEqual(
        probes(result)
            .slice(1)
            .map(probe => probe.category),
        ['OK', 'OK', 'OK'],
    );
    assert.equal(api.entries.length, 5);
    assertNoSecrets(result);
});

test('does not follow a response redirect or expose its Location header', async t => {
    let redirectedRequests = 0;
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === names[0]) {
            response.writeHead(302, { location: 'https://fixture-header-private.example.invalid/' });
            return response.end();
        }
        if (!entry.operation) redirectedRequests++;
        normal(response, entry);
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(probes(result)[0].category, 'REQUEST_FAILED');
    assert.equal(redirectedRequests, 0);
    assert.equal(api.entries.length, 5);
    assertNoSecrets(result);
});

test('caps both declared and streamed response bytes before JSON parsing', async t => {
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === names[0]) {
            response.writeHead(200, {
                'content-type': 'application/json',
                'content-length': 3 * 1024 * 1024,
            });
            return response.end('fixture-error-private');
        }
        if (entry.operation === names[1]) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.write(' '.repeat(1024 * 1024));
            response.write(' '.repeat(1024 * 1024));
            return response.end('fixture-error-private');
        }
        normal(response, entry);
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.deepEqual(
        probes(result).map(probe => probe.category),
        ['PAYLOAD_LIMIT', 'PAYLOAD_LIMIT', 'OK', 'OK'],
    );
    assertNoSecrets(result);
});

test('aborts a response-body timeout and still measures later probes', async t => {
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === names[0]) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.write('{"data":');
            return;
        }
        normal(response, entry);
    });
    const started = Date.now();
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(probes(result)[0].category, 'TIMEOUT');
    assert.ok(Date.now() - started < 10_000);
    assert.deepEqual(
        probes(result)
            .slice(1)
            .map(probe => probe.category),
        ['OK', 'OK', 'OK'],
    );
    assertNoSecrets(result);
});

test('stops at the overall deadline, preserving completed and unmeasured results', async t => {
    let now = 1_000;
    const api = await fixture(t, (entry, response) => {
        normal(response, entry);
        if (entry.operation === names[0]) now = 61_000;
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request, clock: () => now });
    assert.equal(result.category, 'BUDGET_EXHAUSTED');
    assert.deepEqual(
        probes(result).map(probe => probe.category),
        ['OK', 'BUDGET_EXHAUSTED'],
    );
    assert.deepEqual(
        probes(result).map(probe => probe.operation),
        ['primary_minimal', 'alias_minimal'],
    );
    assert.equal(api.entries.length, 2);
    assertNoSecrets(result);
});

test('shortens the final request to the remaining total budget, including body reading', async t => {
    let now = 0;
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === 'IcloudRelayDiagnosticLogin') {
            now = 29_975;
            return login(response);
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"fixture-error-private":');
    });
    const started = Date.now();
    const result = await diagnoseIcloudRelay({
        ...credentials,
        request: api.request,
        budgetMs: 30_000,
        clock: () => now,
    });
    assert.equal(result.category, 'BUDGET_EXHAUSTED');
    assert.equal(probes(result)[0].category, 'BUDGET_EXHAUSTED');
    assert.ok(Date.now() - started < 1_000);
    assert.equal(api.entries.length, 2);
    assertNoSecrets(result);
});

test('bounds complete sixteen-channel receipts without losing operation results', async t => {
    const path = [
        'icloudPrimaryAccounts',
        9999,
        'codeResetIntervalDays',
        'primaryAccountEmail',
        'lastMailReceivedAt',
        'lastQueriedAt',
        'virtualEmailCount',
        'buyerQueryCode',
    ];
    const errors = [
        { message: 'fixture-error-private', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' }, path },
        ...Array.from({ length: 39_999 }, () => ({})),
    ];
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === 'IcloudRelayDiagnosticLogin') return login(response, 16);
        json(
            response,
            { errors },
            { 'content-type': 'application/graphql-response+json; fixture-header-private' },
        );
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assert.equal(result.category, 'PARTIAL_FAILURE');
    assert.equal(result.detailsOmitted, true);
    assert.equal(result.channelCount, 16);
    assert.equal(probes(result).length, 64);
    assert.ok(
        probes(result).every(
            probe =>
                probe.category === 'GRAPHQL_SCHEMA' &&
                probe.code === 'GRAPHQL_VALIDATION_FAILED' &&
                probe.errorCount === 40_000 &&
                !('path' in probe),
        ),
    );
    assert.equal(api.entries.length, 65);
    assert.equal(api.maximumActive(), 1);
    assertNoSecrets(result);
});

test('bounds mixed GraphQL errors with a representative code matching their failure category', async t => {
    const path = [
        'icloudPrimaryAccounts',
        9999,
        'codeResetIntervalDays',
        'primaryAccountEmail',
        'lastMailReceivedAt',
        'lastQueriedAt',
        'virtualEmailCount',
        'buyerQueryCode',
    ];
    const errors = [
        { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' }, path },
        { extensions: { code: 'UNAUTHENTICATED' }, path },
        ...Array.from({ length: 99_998 }, () => ({})),
    ];
    const api = await fixture(t, (entry, response) => {
        if (entry.operation === 'IcloudRelayDiagnosticLogin') return login(response, 16);
        json(response, { errors }, { 'content-type': 'application/graphql-response+json' });
    });
    const result = await diagnoseIcloudRelay({ ...credentials, request: api.request });
    assertNoSecrets(result);
    assert.equal(result.detailsOmitted, true);
    assert.equal(probes(result).length, 64);
    assert.ok(
        probes(result).every(
            probe =>
                probe.category === 'GRAPHQL_AUTHORIZATION' &&
                probe.code === 'UNAUTHENTICATED' &&
                probe.errorCount === 100_000,
        ),
    );
});

test('rejects arbitrary origins, queries, headers, invalid budgets and unavailable credentials before transport', async () => {
    let calls = 0;
    const request = () => {
        calls++;
        throw new Error('fixture-error-private');
    };
    for (const extra of [
        { apiOrigin: 'https://fixture-header-private.invalid' },
        { url: ICLOUD_DIAGNOSTIC_URL },
        { query: 'mutation DeleteMail { deleteIcloudMail(id: "1") }' },
        { headers: { secret: privateMarkers[3] } },
        { budgetMs: 29_999 },
        { budgetMs: 90_001 },
        { budgetMs: Infinity },
        { clock: () => NaN },
    ]) {
        const result = await diagnoseIcloudRelay({ ...credentials, request, ...extra });
        assert.equal(result.category, 'INVALID_CONFIGURATION');
        assertNoSecrets(result);
    }
    for (const invalid of [
        { username: '' },
        { password: '' },
        { username: 'x'.repeat(257) },
        { password: 'x'.repeat(4097) },
        { password: 'bad\u0000secret' },
    ]) {
        const result = await diagnoseIcloudRelay({ ...credentials, request, ...invalid });
        assert.equal(result.category, 'CREDENTIALS_UNAVAILABLE');
        assertNoSecrets(result);
    }
    assert.equal(calls, 0);
});

test('emits one safe CLI receipt for configuration failures without stderr or network calls', async () => {
    const executable = fileURLToPath(new URL('./icloud-relay-diagnostic.mjs', import.meta.url));
    for (const args of [[], ['https://fixture-header-private.invalid']]) {
        const output = await promisify(execFile)(process.execPath, [executable, ...args], {
            env: {},
            cwd: fileURLToPath(new URL('../', import.meta.url)),
        }).then(
            value => value,
            error => error,
        );
        assert.equal(output.code, 1);
        assert.equal(output.stderr, '');
        assert.equal(output.stdout.trim().split('\n').length, 1);
        const result = JSON.parse(output.stdout);
        assert.equal(result.category, args.length ? 'INVALID_CONFIGURATION' : 'CREDENTIALS_UNAVAILABLE');
        assertNoSecrets(result);
    }
});
