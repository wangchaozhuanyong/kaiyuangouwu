import { pathToFileURL } from 'node:url';

// This is a server-side diagnostic, never an arbitrary GraphQL or external-origin client.
export const ICLOUD_DIAGNOSTIC_URL = 'http://127.0.0.1:3002/admin-api';
const MAX_CHANNELS = 16;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RECEIPT_BYTES = 12 * 1024;
const PRIMARY_FIELDS = `id createdAt updatedAt email note status imapHost imapPort masterQueryCode
    codeExpiresAt codeResetIntervalDays remainingDays lastQueriedAt lastQueriedIp lastSyncedAt
    lastSyncError virtualEmailCount`;
const ALIAS_FIELDS = `id createdAt updatedAt primaryAccountId primaryAccountEmail aliasEmail note status
    buyerQueryCode codeExpiresAt codeResetIntervalDays remainingDays lastQueriedAt lastQueriedIp
    mailCount lastMailReceivedAt`;
const LOGIN = `mutation IcloudRelayDiagnosticLogin($username: String!, $password: String!) {
    login(username: $username, password: $password, rememberMe: false) {
        __typename ... on CurrentUser { id channels { code token } }
    }
}`;
const OPERATIONS = Object.freeze([
    Object.freeze({
        operation: 'IcloudRelayPrimaryMinimal',
        label: 'primary_minimal',
        field: 'icloudPrimaryAccounts',
        query: 'query IcloudRelayPrimaryMinimal { icloudPrimaryAccounts { id } }',
    }),
    Object.freeze({
        operation: 'IcloudRelayAliasMinimal',
        label: 'alias_minimal',
        field: 'icloudVirtualEmails',
        query: 'query IcloudRelayAliasMinimal { icloudVirtualEmails { id } }',
    }),
    Object.freeze({
        operation: 'IcloudRelayPrimaryFull',
        label: 'primary_full',
        field: 'icloudPrimaryAccounts',
        query: `query IcloudRelayPrimaryFull { icloudPrimaryAccounts { ${PRIMARY_FIELDS} } }`,
    }),
    Object.freeze({
        operation: 'IcloudRelayAliasFull',
        label: 'alias_full',
        field: 'icloudVirtualEmails',
        query: `query IcloudRelayAliasFull { icloudVirtualEmails { ${ALIAS_FIELDS} } }`,
    }),
]);
const SAFE_ERROR_CODES = new Set([
    'FORBIDDEN',
    'UNAUTHENTICATED',
    'GRAPHQL_VALIDATION_FAILED',
    'GRAPHQL_PARSE_FAILED',
    'BAD_USER_INPUT',
    'INTERNAL_SERVER_ERROR',
    'QUERY_TOO_COMPLEX',
    'MAX_QUERY_DEPTH_EXCEEDED',
]);
const SAFE_PATH_FIELDS = new Set([
    ...PRIMARY_FIELDS.split(/\s+/u),
    ...ALIAS_FIELDS.split(/\s+/u),
    'icloudPrimaryAccounts',
    'icloudVirtualEmails',
    'login',
    'channels',
    'code',
    'token',
    '__typename',
]);
const CONFIG_KEYS = new Set(['username', 'password', 'request', 'budgetMs', 'clock']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class DiagnosticFailure extends Error {
    constructor(category) {
        super(category);
        this.category = category;
    }
}

function safeContentType(headers) {
    const value = headers.get('content-type');
    if (typeof value !== 'string' || !value.trim()) return 'missing';
    const type = value.split(';', 1)[0].trim().toLowerCase();
    return (
        new Map([
            ['application/json', 'json'],
            ['application/graphql-response+json', 'graphql-json'],
            ['text/html', 'html'],
            ['text/plain', 'text'],
        ]).get(type) ?? 'other'
    );
}

function safeError(error) {
    const code = SAFE_ERROR_CODES.has(error?.extensions?.code) ? error.extensions.code : 'UNKNOWN';
    const parts = error?.path;
    const validPath =
        Array.isArray(parts) &&
        parts.length > 0 &&
        parts.length <= 8 &&
        parts.every(part =>
            typeof part === 'number'
                ? Number.isInteger(part) && part >= 0 && part <= 9_999
                : SAFE_PATH_FIELDS.has(part),
        );
    return { code, path: validPath ? parts : null };
}

function graphqlFailure(errors) {
    const authorization = errors.find(error =>
        ['FORBIDDEN', 'UNAUTHENTICATED'].includes(error?.extensions?.code),
    );
    if (authorization) return { category: 'GRAPHQL_AUTHORIZATION', error: authorization };
    const schema = errors.find(error =>
        ['GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED'].includes(error?.extensions?.code),
    );
    if (schema) return { category: 'GRAPHQL_SCHEMA', error: schema };
    return { category: 'GRAPHQL_ERROR', error: errors[0] };
}

function discardBody(response) {
    // Do not read error bodies or wait on untrusted cancellation promises.
    try {
        void response.body?.cancel().catch(() => undefined);
    } catch {
        // Cancellation is best effort; never expose an untrusted cancellation error.
        return;
    }
}

async function readBoundedJson(response) {
    const declaredLength = response.headers.get('content-length');
    if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
        discardBody(response);
        throw new DiagnosticFailure('PAYLOAD_LIMIT');
    }
    if (!response.body?.getReader) throw new DiagnosticFailure('INVALID_ENVELOPE');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
            void reader.cancel().catch(() => undefined);
            throw new DiagnosticFailure('PAYLOAD_LIMIT');
        }
        chunks.push(value);
    }
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    } catch {
        throw new DiagnosticFailure('INVALID_JSON');
    }
}

/** Credentials, authentication headers, channel tokens and returned rows never leave this call. */
async function runDiagnostic(options = {}) {
    const receipt = {
        diagnostic: 'icloud-relay',
        category: 'INVALID_CONFIGURATION',
        login: null,
        channelCount: 0,
        channelsTruncated: false,
        detailsOmitted: false,
        channels: [],
    };
    try {
        if (!isObject(options) || Object.keys(options).some(key => !CONFIG_KEYS.has(key))) return receipt;
        const {
            username = process.env.SUPERADMIN_USERNAME,
            password = process.env.SUPERADMIN_PASSWORD,
            request = fetch,
            budgetMs = 60_000,
            // Dependency injection is only used by local fixtures; CLI callers cannot override it.
            clock = Date.now,
        } = options;
        if (
            typeof request !== 'function' ||
            typeof clock !== 'function' ||
            !Number.isInteger(budgetMs) ||
            budgetMs < 30_000 ||
            budgetMs > 90_000
        )
            return receipt;
        if (
            typeof username !== 'string' ||
            typeof password !== 'string' ||
            !username.trim() ||
            !password ||
            /[\u0000\r\n]/u.test(username) ||
            /[\u0000\r\n]/u.test(password) ||
            username.length > 256 ||
            password.length > 4_096
        ) {
            receipt.category = 'CREDENTIALS_UNAVAILABLE';
            return receipt;
        }
        const startedAt = clock();
        if (!Number.isFinite(startedAt)) return receipt;
        const deadline = startedAt + budgetMs;
        let auth = '';
        async function run(operation, document, variables, channel = '') {
            const record = {
                operation,
                status: null,
                contentType: 'missing',
                category: 'REQUEST_FAILED',
                count: null,
                errorCount: 0,
                code: null,
                path: null,
            };
            const remainingMs = deadline - clock();
            if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
                record.category = 'BUDGET_EXHAUSTED';
                return { record };
            }
            const controller = new AbortController();
            let timer;
            let timedOut = false;
            let active = true;
            const timeoutCategory = remainingMs <= REQUEST_TIMEOUT_MS ? 'BUDGET_EXHAUSTED' : 'TIMEOUT';
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(
                    () => {
                        timedOut = true;
                        controller.abort();
                        reject(new DiagnosticFailure(timeoutCategory));
                    },
                    Math.min(REQUEST_TIMEOUT_MS, remainingMs),
                );
            });
            try {
                const task = async () => {
                    const response = await request(ICLOUD_DIAGNOSTIC_URL, {
                        method: 'POST',
                        redirect: 'error',
                        signal: controller.signal,
                        headers: {
                            'content-type': 'application/json',
                            accept: 'application/json',
                            'cache-control': 'no-store',
                            ...(auth ? { authorization: `Bearer ${auth}` } : {}),
                            ...(channel ? { 'vendure-token': channel } : {}),
                        },
                        body: JSON.stringify({ query: document, variables }),
                    });
                    if (!active) throw new DiagnosticFailure('TIMEOUT');
                    record.status =
                        Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
                            ? response.status
                            : null;
                    record.contentType = safeContentType(response.headers);
                    if (record.status === null || response.status < 200 || response.status >= 300) {
                        discardBody(response);
                        throw new DiagnosticFailure('HTTP_ERROR');
                    }
                    if (!['json', 'graphql-json'].includes(record.contentType)) {
                        discardBody(response);
                        throw new DiagnosticFailure('UNEXPECTED_CONTENT_TYPE');
                    }
                    const envelope = await readBoundedJson(response);
                    if (!active) throw new DiagnosticFailure('TIMEOUT');
                    if (
                        !isObject(envelope) ||
                        ('errors' in envelope &&
                            (!Array.isArray(envelope.errors) || !envelope.errors.every(isObject)))
                    )
                        throw new DiagnosticFailure('INVALID_ENVELOPE');
                    if (envelope.errors?.length) {
                        const failure = graphqlFailure(envelope.errors);
                        record.errorCount = envelope.errors.length;
                        // Keep the representative code/path consistent with the failure category.
                        Object.assign(record, safeError(failure.error));
                        throw new DiagnosticFailure(failure.category);
                    }
                    if (!isObject(envelope.data)) throw new DiagnosticFailure('INVALID_ENVELOPE');
                    return {
                        data: envelope.data,
                        // Only the login result consumes this header; it is never a receipt field.
                        token: operation === 'login' ? response.headers.get('vendure-auth-token') : null,
                    };
                };
                const result = await Promise.race([task(), timeout]);
                record.category = 'OK';
                return { record, ...result };
            } catch (error) {
                record.category = timedOut
                    ? timeoutCategory
                    : error instanceof DiagnosticFailure
                      ? error.category
                      : 'REQUEST_FAILED';
                return { record };
            } finally {
                active = false;
                clearTimeout(timer);
            }
        }
        const loginResult = await run('login', LOGIN, {
            username: username.trim(),
            password,
        });
        receipt.login = loginResult.record;
        if (loginResult.record.category !== 'OK') {
            receipt.category =
                loginResult.record.category === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : 'LOGIN_FAILED';
            return receipt;
        }
        const login = loginResult.data.login;
        if (isObject(login) && login.__typename && login.__typename !== 'CurrentUser') {
            receipt.login.category = 'LOGIN_REJECTED';
            receipt.category = 'LOGIN_REJECTED';
            return receipt;
        }
        const headerToken = value => typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/u.test(value);
        if (
            !isObject(login) ||
            login.__typename !== 'CurrentUser' ||
            !Array.isArray(login.channels) ||
            !login.channels.length ||
            !headerToken(loginResult.token) ||
            login.channels
                .slice(0, MAX_CHANNELS)
                .some(
                    channel =>
                        !isObject(channel) || !headerToken(channel.token) || channel.token.length > 512,
                )
        ) {
            receipt.login.category = 'LOGIN_INVALID';
            receipt.category = 'LOGIN_FAILED';
            return receipt;
        }
        if (login.channels.length > MAX_CHANNELS) {
            receipt.channelCount = 0;
            receipt.channelsTruncated = true;
            receipt.category = 'CHANNEL_LIMIT';
            return receipt;
        }
        auth = loginResult.token;
        const channels = login.channels.slice(0, MAX_CHANNELS);
        receipt.channelCount = channels.length;
        receipt.channelsTruncated = login.channels.length > MAX_CHANNELS;
        for (const [index, channel] of channels.entries()) {
            const channelIndex = index + 1;
            const isDefaultChannel = channel.code === '__default_channel__';
            const channelResult = { channelIndex, isDefaultChannel, probes: [] };
            receipt.channels.push(channelResult);
            for (const operation of OPERATIONS) {
                const result = await run(operation.label, operation.query, {}, channel.token);
                if (result.record.category === 'OK') {
                    const rows = result.data[operation.field];
                    if (!Array.isArray(rows) || rows.length > 100_000 || !rows.every(isObject))
                        result.record.category = 'INVALID_ENVELOPE';
                    else result.record.count = rows.length;
                }
                channelResult.probes.push(result.record);
                if (result.record.category === 'BUDGET_EXHAUSTED') {
                    receipt.category = 'BUDGET_EXHAUSTED';
                    return receipt;
                }
            }
        }
        receipt.category = receipt.channels.some(channel =>
            channel.probes.some(probe => probe.category !== 'OK'),
        )
            ? 'PARTIAL_FAILURE'
            : 'OK';
        return receipt;
    } catch {
        // Even malformed injected configuration or transport objects cannot expose their error text.
        receipt.category = 'DIAGNOSTIC_FAILED';
        return receipt;
    }
}

export async function diagnoseIcloudRelay(options = {}) {
    const receipt = await runDiagnostic(options);
    if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > MAX_RECEIPT_BYTES) {
        receipt.detailsOmitted = true;
        if (receipt.login) delete receipt.login.path;
        for (const channel of receipt.channels) for (const probe of channel.probes) delete probe.path;
    }
    return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const options = process.argv.length === 2 ? {} : { unsupportedArguments: true };
    diagnoseIcloudRelay(options)
        .then(receipt => {
            process.stdout.write(`${JSON.stringify(receipt)}\n`);
            if (receipt.category !== 'OK') process.exitCode = 1;
        })
        .catch(() => {
            process.stdout.write('{"diagnostic":"icloud-relay","category":"DIAGNOSTIC_FAILED"}\n');
            process.exitCode = 1;
        });
}
