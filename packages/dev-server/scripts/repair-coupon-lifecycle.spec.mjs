import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { runCouponRepair } from './repair-coupon-lifecycle.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'coupon-repair-cli-'));
after(() => rm(directory, { recursive: true, force: true }));
const plan = {
    repairVersion: 'coupon-lifecycle-v1',
    channelId: '1',
    campaignId: '2',
    fingerprint: 'reviewed-fingerprint',
    changes: { coupons: [] },
};
function harness(out) {
    const calls = [];
    return {
        calls,
        options: {
            apiOrigin: 'http://127.0.0.1:3322',
            channelId: 'T_1',
            campaignId: 'T_2',
            username: 'test-admin',
            password: 'test-password',
            out: path.join(directory, out),
            fetchImpl: async (_url, input) => {
                const request = JSON.parse(input.body);
                calls.push(request);
                const data = request.query.includes('login(')
                    ? { login: { channels: [{ id: 'T_1', token: 'test-channel-token' }] } }
                    : request.query.includes('repairStoreCouponCampaign(')
                      ? { repairStoreCouponCampaign: { changedCoupons: 0, after: plan } }
                      : { storeCouponRepairPreview: plan };
                return new Response(JSON.stringify({ data }), {
                    status: 200,
                    headers: { 'vendure-auth-token': 'test-auth-token', 'content-type': 'application/json' },
                });
            },
        },
    };
}

test('preview makes no repair mutation and saves only a review snapshot', async () => {
    const { options, calls } = harness('preview.json');
    const result = await runCouponRepair(options);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].query.startsWith('query'));
    assert.equal(result.target.campaignId, 'T_2');
    const text = await readFile(options.out, 'utf8');
    assert.equal(text.includes('test-password'), false);
    assert.equal(text.includes('test-auth-token'), false);
    assert.equal(text.includes('test-channel-token'), false);
});

test('apply submits the saved fingerprint and supports encoded GraphQL IDs', async () => {
    const { options, calls } = harness('receipt.json');
    const reviewed = path.join(directory, 'reviewed.json');
    await writeFile(
        reviewed,
        JSON.stringify({
            target: {
                apiOrigin: options.apiOrigin,
                channelId: options.channelId,
                campaignId: options.campaignId,
            },
            plan,
        }),
    );
    await runCouponRepair({ ...options, apply: true, planFile: reviewed });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].variables.fingerprint, 'reviewed-fingerprint');
    assert.ok(calls[1].query.includes('repairStoreCouponCampaign('));
});

test('rejects a plan for another target before making a request', async () => {
    const { options, calls } = harness('wrong-target.json');
    const reviewed = path.join(directory, 'wrong-plan.json');
    await writeFile(
        reviewed,
        JSON.stringify({
            target: {
                apiOrigin: options.apiOrigin,
                channelId: 'another-channel',
                campaignId: options.campaignId,
            },
            plan,
        }),
    );
    await assert.rejects(
        runCouponRepair({ ...options, apply: true, planFile: reviewed }),
        /different Channel/,
    );
    assert.equal(calls.length, 0);
});

test('refuses remote writes and existing output paths before sending requests', async () => {
    const { options, calls } = harness('already-exists.json');
    await assert.rejects(
        runCouponRepair({ ...options, apiOrigin: 'https://example.com', apply: true }),
        /allow-remote/,
    );
    await writeFile(options.out, 'keep existing review');
    await assert.rejects(runCouponRepair(options), /EEXIST/);
    assert.equal(calls.length, 0);
    assert.equal(await readFile(options.out, 'utf8'), 'keep existing review');
});

test('refuses applying another repair version before any request', async () => {
    const { options, calls } = harness('wrong-version.json');
    const reviewed = path.join(directory, 'wrong-version-plan.json');
    await writeFile(
        reviewed,
        JSON.stringify({
            target: {
                apiOrigin: options.apiOrigin,
                channelId: options.channelId,
                campaignId: options.campaignId,
            },
            plan,
        }),
    );
    await assert.rejects(
        runCouponRepair({ ...options, version: 'coupon-closure-v2', apply: true, planFile: reviewed }),
        /different repair version/,
    );
    assert.equal(calls.length, 0);
});
