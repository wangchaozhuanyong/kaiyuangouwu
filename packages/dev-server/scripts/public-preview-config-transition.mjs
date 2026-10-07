import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Login + preflight + per-store writes/readbacks + logout: at most fourteen native requests.
export const NATIVE_TRANSITION_BUDGET = Object.freeze({
    requestTimeoutMs: 30_000,
    maxRequests: 14,
    executionTimeoutSeconds: 480,
    pollingMarginMs: 30_000,
});

// Only the two stores named in the human's transition authorization are eligible.
export function validateTransitionPlan(plan) {
    const fail = () => {
        throw new Error('TRANSITION_PLAN_REJECTED');
    };
    const scope = [
        { profileId: '2', channelId: '2', primaryDomain: 'damatong.net' },
        { profileId: '3', channelId: '5', primaryDomain: 'moyaoai.com' },
    ];
    if (!Array.isArray(plan) || plan.length !== scope.length) fail();
    for (const expected of scope) {
        const row = plan.find(item => item?.profileId === expected.profileId);
        if (
            !row ||
            row.channelId !== expected.channelId ||
            row.primaryDomain !== expected.primaryDomain ||
            row.status !== 'DRAFT' ||
            row.isPublished !== false ||
            row.proposedIsPublished !== true ||
            row.eligible !== true ||
            !Number.isFinite(Date.parse(row.expectedUpdatedAt))
        )
            fail();
    }
    return scope.map(expected => ({
        ...expected,
        expectedUpdatedAt: plan.find(item => item.profileId === expected.profileId).expectedUpdatedAt,
    }));
}

export async function runConfigurationTransition(plan, api, mode) {
    const targets = validateTransitionPlan(plan);
    if (!['inspect', 'apply'].includes(mode)) throw new Error('TRANSITION_MODE_REJECTED');
    const receipt = { mode, status: 'PREFLIGHT', stores: [], mutationsAttempted: 0 };
    const assertProfile = (value, target, published, checkVersion = true) => {
        if (
            !value ||
            String(value.id) !== target.profileId ||
            String(value.channel?.id) !== target.channelId ||
            value.status !== 'DRAFT' ||
            value.primaryDomain !== target.primaryDomain ||
            value.isPublished !== published ||
            !Number.isFinite(Date.parse(value.updatedAt)) ||
            (checkVersion && Date.parse(value.updatedAt) !== Date.parse(target.expectedUpdatedAt))
        ) {
            throw new Error('TRANSITION_SCOPE_OR_VERSION_CHANGED');
        }
    };
    const safeProfile = value => ({
        profileId: String(value.id),
        channelId: String(value.channel.id),
        status: value.status,
        isPublished: value.isPublished,
        primaryDomain: value.primaryDomain,
        updatedAt: value.updatedAt,
    });
    // Both captured versions must still match before the first mutation.
    for (const target of targets) {
        const before = await api.read(target.channelId);
        assertProfile(before, target, false);
        receipt.stores.push({ target, before: safeProfile(before), status: 'VERIFIED' });
    }
    if (mode === 'inspect') {
        receipt.status = 'READY';
        return receipt;
    }
    for (const item of receipt.stores) {
        try {
            assertProfile(await api.read(item.target.channelId), item.target, false);
            item.status = 'MUTATION_ATTEMPTED';
            receipt.mutationsAttempted++;
            try {
                await api.enable(item.target.channelId, item.target.expectedUpdatedAt);
                item.mutationResponse = 'RECEIVED';
            } catch {
                // A lost/failed response is not permission to repeat a write.
                item.mutationResponse = 'FAILED_OR_LOST';
            }
            let after;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    after = await api.read(item.target.channelId);
                    break;
                } catch {
                    /* Read only retry. */
                }
            }
            if (!after) {
                item.status = 'WRITE_OUTCOME_UNKNOWN';
                receipt.status = 'RECONCILIATION_REQUIRED';
                break;
            }
            item.after = safeProfile(after);
            if (after.isPublished !== true) {
                item.status = 'NOT_ENABLED';
                receipt.status = 'RECONCILIATION_REQUIRED';
                break;
            }
            assertProfile(after, item.target, true, false);
            if (Date.parse(after.updatedAt) <= Date.parse(item.before.updatedAt)) {
                throw new Error('TRANSITION_VERSION_DID_NOT_ADVANCE');
            }
            item.status = 'SAVED_AND_READ_BACK';
        } catch {
            item.status =
                item.status === 'MUTATION_ATTEMPTED'
                    ? 'RECONCILIATION_REQUIRED'
                    : 'SCOPE_OR_VERSION_CONFLICT';
            receipt.status = 'RECONCILIATION_REQUIRED';
            break;
        }
    }
    if (receipt.stores.every(item => item.status === 'SAVED_AND_READ_BACK')) receipt.status = 'COMPLETE';
    return receipt;
}

export async function nativeTransitionApi(environment, request) {
    if (!environment.SUPERADMIN_USERNAME || !environment.SUPERADMIN_PASSWORD)
        throw new Error('NATIVE_CREDENTIALS_UNAVAILABLE');
    const port = Number(environment.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NATIVE_PORT_UNVERIFIED');
    let auth = '';
    let channels = [];
    const fields = 'id updatedAt status isPublished primaryDomain channel { id }';
    const query = async (document, variables = {}, channelId) => {
        const channel =
            channelId === undefined ? undefined : channels.find(item => String(item.id) === channelId);
        if (channelId !== undefined && !channel?.token) throw new Error('NATIVE_CHANNEL_UNAVAILABLE');
        try {
            const response = await request(`http://127.0.0.1:${port}/admin-api`, {
                method: 'POST',
                signal: AbortSignal.timeout(NATIVE_TRANSITION_BUDGET.requestTimeoutMs),
                headers: {
                    'content-type': 'application/json',
                    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
                    ...(channel ? { 'vendure-token': channel.token } : {}),
                },
                body: JSON.stringify({ query: document, variables }),
            });
            if (!response.ok) throw new Error('HTTP');
            const payload = await response.text();
            if (payload.length > 1_000_000) throw new Error('SIZE');
            const result = JSON.parse(payload);
            // Never persist or print native API errors, headers, credentials or tokens.
            if (result.errors?.length || !result.data) throw new Error('API');
            auth ||= response.headers.get('vendure-auth-token') || '';
            return result.data;
        } catch {
            throw new Error('NATIVE_QUERY_FAILED');
        }
    };
    const { login } = await query(
        `mutation PreviewTransitionLogin($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: false) {
            ... on CurrentUser { id channels { id token } }
        }
    }`,
        { username: environment.SUPERADMIN_USERNAME, password: environment.SUPERADMIN_PASSWORD },
    );
    channels = login?.channels || [];
    if (!login?.id || !auth || !channels.length) throw new Error('NATIVE_LOGIN_REJECTED');
    return {
        read: async channelId => {
            const data = await query(
                `query PreviewTransitionProfile {
                activeChannel { id } myStoreProfile { ${fields} }
            }`,
                {},
                channelId,
            );
            if (String(data.activeChannel?.id) !== channelId)
                throw new Error('NATIVE_ACTIVE_CHANNEL_MISMATCH');
            return data.myStoreProfile;
        },
        enable: async (channelId, expectedUpdatedAt) => {
            const data = await query(
                `mutation PreviewTransitionEnable($input: UpdateMyStoreProfileInput!) {
                updateMyStoreProfile(input: $input) { ${fields} }
            }`,
                { input: { expectedUpdatedAt, isPublished: true } },
                channelId,
            );
            return data.updateMyStoreProfile;
        },
        close: async () => {
            const data = await query('mutation PreviewTransitionLogout { logout { success } }');
            if (data.logout?.success !== true) throw new Error('NATIVE_LOGOUT_UNCONFIRMED');
            auth = '';
            channels = [];
        },
    };
}

async function main() {
    const [mode, profile, auditPath, output] = process.argv.slice(2);
    assert.ok(['inspect', 'apply'].includes(mode));
    assert.equal(profile, 'vendure-prod');
    assert.ok(path.isAbsolute(auditPath) && path.isAbsolute(output));
    const audit = JSON.parse(await readFile(auditPath, 'utf8'));
    assert.equal(audit.status, 'SNAPSHOT_COMPLETE');
    assert.equal(audit.evidence?.instance, 'i-041a146558e432cbf');
    assert.ok(Date.now() - Date.parse(audit.capturedAt) < 60 * 60 * 1000, 'Fresh preflight required');
    validateTransitionPlan(audit.transition);
    const planDigest = createHash('sha256').update(JSON.stringify(audit.transition)).digest('hex');
    const transport = `import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { realpathSync } from 'node:fs';
const NATIVE_TRANSITION_BUDGET = ${JSON.stringify(NATIVE_TRANSITION_BUDGET)};
${validateTransitionPlan.toString()}
${runConfigurationTransition.toString()}
${nativeTransitionApi.toString()}
const plan = ${JSON.stringify(audit.transition)};
const mode = ${JSON.stringify(mode)};
let receipt = { mode, status: 'FAILED_BEFORE_WRITE' }, api;
try {
    const runtimeDirectory = realpathSync('/var/www/kaiyuangouwu-current');
    if (runtimeDirectory !== ${JSON.stringify(audit.runtimeDirectory)}) throw new Error('RUNTIME_CHANGED');
    api = await nativeTransitionApi(process.env, fetch);
    receipt = await runConfigurationTransition(plan, api, mode);
    receipt.runtimeDirectory = runtimeDirectory;
} catch {
    receipt.failure = 'NATIVE_PREFLIGHT_OR_EXECUTION_FAILED';
} finally {
    if (api) {
        try { await api.close(); receipt.sessionClosed = true; }
        catch { receipt.sessionClosed = false; }
    }
}
receipt.capturedAt = new Date().toISOString();
const body = JSON.stringify(receipt);
console.log('PREVIEW_TRANSITION_SHA256=' + createHash('sha256').update(body).digest('hex'));
console.log('PREVIEW_TRANSITION_GZIP=' + gzipSync(body).toString('base64'));
`;
    const region = 'ap-northeast-1';
    const instance = 'i-041a146558e432cbf';
    const aws = args =>
        JSON.parse(
            execFileSync(
                'aws',
                [
                    ...args,
                    '--profile',
                    profile,
                    '--region',
                    region,
                    '--output',
                    'json',
                    '--cli-read-timeout',
                    '30',
                ],
                { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
            ),
        );
    const command =
        "sudo -H -u ubuntu /usr/bin/node --env-file=/var/www/kaiyuangouwu/packages/dev-server/.env --input-type=module <<'PREVIEW_TRANSITION_END'\n" +
        transport +
        '\nPREVIEW_TRANSITION_END';
    const sent = aws([
        'ssm',
        'send-command',
        '--document-name',
        'AWS-RunShellScript',
        '--instance-ids',
        instance,
        '--comment',
        `Authorized public preview ${mode}`,
        '--parameters',
        JSON.stringify({
            commands: [command],
            executionTimeout: [String(NATIVE_TRANSITION_BUDGET.executionTimeoutSeconds)],
        }),
    ]);
    const commandId = sent.Command.CommandId;
    process.stdout.write(`Native transition ${mode} submitted: ${commandId}\n`);
    let result;
    const deadline =
        Date.now() +
        NATIVE_TRANSITION_BUDGET.executionTimeoutSeconds * 1000 +
        NATIVE_TRANSITION_BUDGET.pollingMarginMs;
    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        try {
            result = aws([
                'ssm',
                'get-command-invocation',
                '--command-id',
                commandId,
                '--instance-id',
                instance,
            ]);
        } catch {
            continue;
        }
        if (!['Pending', 'InProgress', 'Delayed'].includes(result.Status)) break;
    }
    if (result?.Status !== 'Success' || result.ResponseCode !== 0)
        throw new Error('TRANSITION_TRANSPORT_RECONCILIATION_REQUIRED');
    const checksum = result.StandardOutputContent.match(/^PREVIEW_TRANSITION_SHA256=([a-f0-9]{64})$/mu)?.[1];
    const payload = result.StandardOutputContent.match(/^PREVIEW_TRANSITION_GZIP=([a-zA-Z0-9+/=]+)$/mu)?.[1];
    assert.ok(checksum && payload, 'Transition output missing; do not repeat writes');
    const body = gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
    assert.equal(createHash('sha256').update(body).digest('hex'), checksum);
    const receipt = JSON.parse(body);
    receipt.evidence = {
        commandId,
        instance,
        planDigest,
        snapshotSha256: checksum,
        sourceSha256: createHash('sha256')
            .update(await readFile(new URL(import.meta.url)))
            .digest('hex'),
    };
    await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(
        JSON.stringify({
            status: receipt.status,
            stores: receipt.stores?.map(item => ({
                profileId: item.target.profileId,
                status: item.status,
            })),
            sessionClosed: receipt.sessionClosed,
            output,
        }) + '\n',
    );
    if (!['READY', 'COMPLETE'].includes(receipt.status)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(() => {
        process.stderr.write('PREVIEW_TRANSITION_FAILED_REVIEW_RECEIPT_BEFORE_RETRY\n');
        process.exitCode = 1;
    });
}
