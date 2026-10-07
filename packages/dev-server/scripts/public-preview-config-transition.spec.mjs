import assert from 'node:assert/strict';
import test from 'node:test';

import {
    NATIVE_TRANSITION_BUDGET,
    nativeTransitionApi,
    runConfigurationTransition,
    validateTransitionPlan,
} from './public-preview-config-transition.mjs';

test('transport allows the full bounded degraded native flow to finish its receipt and logout', () => {
    assert.ok(
        NATIVE_TRANSITION_BUDGET.executionTimeoutSeconds * 1000 >=
            NATIVE_TRANSITION_BUDGET.maxRequests * NATIVE_TRANSITION_BUDGET.requestTimeoutMs + 60_000,
    );
    assert.ok(NATIVE_TRANSITION_BUDGET.pollingMarginMs >= 30_000);
});

const plan = [
    {
        profileId: '2',
        channelId: '2',
        primaryDomain: 'damatong.net',
        status: 'DRAFT',
        isPublished: false,
        proposedIsPublished: true,
        eligible: true,
        expectedUpdatedAt: '2026-10-03T05:40:18.000Z',
    },
    {
        profileId: '3',
        channelId: '5',
        primaryDomain: 'moyaoai.com',
        status: 'DRAFT',
        isPublished: false,
        proposedIsPublished: true,
        eligible: true,
        expectedUpdatedAt: '2026-10-03T05:38:20.000Z',
    },
];
function fixture() {
    const profiles = new Map(
        plan.map(item => [
            item.channelId,
            {
                id: item.profileId,
                channel: { id: item.channelId },
                primaryDomain: item.primaryDomain,
                status: 'DRAFT',
                isPublished: false,
                updatedAt: item.expectedUpdatedAt,
            },
        ]),
    );
    const writes = [];
    const api = {
        read: async id => structuredClone(profiles.get(id)),
        enable: async (id, version) => {
            assert.equal(profiles.get(id).updatedAt, version);
            writes.push({ id, version });
            profiles.get(id).isPublished = true;
            profiles.get(id).updatedAt = '2026-10-07T05:10:00.000Z';
        },
    };
    return { profiles, writes, api };
}
test('exact authorized scope and inspect perform no mutation', async () => {
    const f = fixture();
    assert.equal((await runConfigurationTransition(plan, f.api, 'inspect')).status, 'READY');
    assert.equal(f.writes.length, 0);
    assert.throws(() => validateTransitionPlan([...plan, { ...plan[0], profileId: '99' }]), /REJECTED/);
    assert.throws(() => validateTransitionPlan([plan[0], { ...plan[1], channelId: '8' }]), /REJECTED/);
});
test('all stores must pass current native scope/version preflight before the first write', async () => {
    for (const field of ['updatedAt', 'primaryDomain', 'status', 'isPublished']) {
        const f = fixture();
        f.profiles.get('5')[field] = {
            updatedAt: '2026-10-07T00:00:00Z',
            primaryDomain: 'other.test',
            status: 'ACTIVE',
            isPublished: true,
        }[field];
        await assert.rejects(runConfigurationTransition(plan, f.api, 'apply'), /SCOPE_OR_VERSION/);
        assert.equal(f.writes.length, 0);
    }
});
test('each store is checked again just before its version-locked mutation', async () => {
    const f = fixture();
    const read = f.api.read;
    let calls = 0;
    f.api.read = async id => {
        if (++calls === 3) f.profiles.get(id).updatedAt = '2026-10-07T00:00:00Z';
        return read(id);
    };
    const result = await runConfigurationTransition(plan, f.api, 'apply');
    assert.equal(result.status, 'RECONCILIATION_REQUIRED');
    assert.equal(result.stores[0].status, 'SCOPE_OR_VERSION_CONFLICT');
    assert.equal(f.writes.length, 0);
});
test('a saved write with a lost response is reconciled by reads and never repeated', async () => {
    const f = fixture();
    const enable = f.api.enable;
    f.api.enable = async (...args) => {
        await enable(...args);
        throw new Error('lost response');
    };
    const result = await runConfigurationTransition(plan, f.api, 'apply');
    assert.equal(result.status, 'COMPLETE');
    assert.deepEqual(
        f.writes.map(item => item.id),
        ['2', '5'],
    );
    assert.ok(result.stores.every(item => item.mutationResponse === 'FAILED_OR_LOST'));
});
test('failed readback retries only reads, then stops before touching the second store', async () => {
    const f = fixture();
    const read = f.api.read;
    let failures = 0;
    f.api.read = async id => {
        if (f.writes.length) {
            failures++;
            throw new Error('network');
        }
        return read(id);
    };
    const result = await runConfigurationTransition(plan, f.api, 'apply');
    assert.equal(result.stores[0].status, 'WRITE_OUTCOME_UNKNOWN');
    assert.equal(f.writes.length, 1);
    assert.equal(failures, 3);
});
test('rejected mutation has one attempt and cannot advance the second store', async () => {
    const f = fixture();
    let attempts = 0;
    f.api.enable = async () => {
        attempts++;
        throw new Error('version rejected');
    };
    const result = await runConfigurationTransition(plan, f.api, 'apply');
    assert.equal(result.stores[0].status, 'NOT_ENABLED');
    assert.equal(result.status, 'RECONCILIATION_REQUIRED');
    assert.equal(attempts, 1);
    assert.equal(f.writes.length, 0);
});
test('native channel mismatch prevents a merchant profile write', async () => {
    const requests = [];
    const api = await nativeTransitionApi(
        { SUPERADMIN_USERNAME: 'test-only-user', SUPERADMIN_PASSWORD: 'test-only-value' },
        async (url, input) => {
            requests.push({ url, input });
            const data =
                requests.length === 1
                    ? { login: { id: '1', channels: [{ id: '2', token: 'test-channel' }] } }
                    : { activeChannel: { id: '5' }, myStoreProfile: null };
            return new Response(JSON.stringify({ data }), {
                headers: { 'vendure-auth-token': 'test-session' },
            });
        },
    );
    await assert.rejects(api.read('2'), /ACTIVE_CHANNEL_MISMATCH/);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].input.headers['vendure-token'], 'test-channel');
    await assert.rejects(api.enable('8', plan[0].expectedUpdatedAt), /CHANNEL_UNAVAILABLE/);
    assert.equal(requests.length, 2);
});
test('native API failures do not expose its error contents or credentials', async () => {
    await assert.rejects(
        nativeTransitionApi(
            { SUPERADMIN_USERNAME: 'test-only-user', SUPERADMIN_PASSWORD: 'test-only-value' },
            async () => new Response(JSON.stringify({ errors: [{ message: 'test-only-value' }] })),
        ),
        error => error.message === 'NATIVE_QUERY_FAILED' && !error.message.includes('test-only-value'),
    );
});
