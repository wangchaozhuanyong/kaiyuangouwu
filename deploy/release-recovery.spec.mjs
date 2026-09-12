import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyChanges } from '../scripts/ci-impact.mjs';

import { classifyFailure } from './release-recovery.mjs';
import { selectReleaseRoute } from './release-route.mjs';

test('only a proven infrastructure fault permits one retry', () => {
    assert.equal(classifyFailure('ECONNRESET downloading artifact', 1).retryAllowed, true);
    assert.equal(classifyFailure('ECONNRESET downloading artifact', 2).retryAllowed, false);
    for (const logs of [
        'TS2345: invalid type',
        'HTTP 503 then AssertionError',
        'AccessDenied',
        '',
        'checksum mismatch',
        'migration failed',
    ])
        assert.equal(classifyFailure(logs).retryAllowed, false);
});
const old = 'a'.repeat(40);
const target = 'b'.repeat(40);
test('a repeated already-active frontend release does not rebuild or deploy', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css']);
    const route = selectReleaseRoute({
        plan,
        baseSha: old,
        targetSha: target,
        storefrontSha: target,
        adminSha: old,
    });
    assert.equal(route.lane, 'none');
});
test('cumulative backend changes and explicit managed writes cannot use a static release', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/core/src/order.ts']);
    assert.equal(
        selectReleaseRoute({ plan, baseSha: old, targetSha: target, storefrontSha: old, adminSha: old }).lane,
        'runtime',
    );
    assert.equal(
        selectReleaseRoute({
            plan: classifyChanges(['packages/storefront/src/index.css']),
            baseSha: old,
            targetSha: target,
            storefrontSha: old,
            adminSha: old,
            managed: true,
        }).lane,
        'runtime',
    );
});
test('independent admin release requires bootstrap and includes both changed frontends', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/next-admin/src/index.css']);
    const input = { plan, baseSha: old, targetSha: target, storefrontSha: old, adminSha: old };
    assert.equal(selectReleaseRoute({ ...input, adminSha: 'unknown' }).lane, 'runtime');
    assert.deepEqual(selectReleaseRoute(input).components, ['next-admin', 'storefront']);
});

test('an active backend with drifted frontend pointers cannot trigger an empty-diff release loop', () => {
    const input = {
        plan: classifyChanges([]),
        baseSha: target,
        targetSha: target,
        storefrontSha: target,
        adminSha: target,
    };
    assert.equal(selectReleaseRoute(input).lane, 'none');
    assert.throws(() => selectReleaseRoute({ ...input, adminSha: old }), /Frontend version drift/u);
});
