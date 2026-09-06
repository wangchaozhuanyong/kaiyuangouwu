import assert from 'node:assert/strict';
import test from 'node:test';

import { assertReviewedStorefrontPublish, storefrontPublishReviewHash } from './sync-damatong-storefront.mjs';

const baseline = {
    scope: { channel: 'a', origin: 'http://localhost' },
    before: { updatedAt: 'v1', enabled: false },
    intended: { title: 'Reviewed title', items: ['a', 'b'] },
};
test('requires a reviewed plan and accepts only its exact current hash', () => {
    const hash = storefrontPublishReviewHash(baseline);
    assert.throws(() => assertReviewedStorefrontPublish(hash, undefined), /Dashboard/);
    assert.doesNotThrow(() => assertReviewedStorefrontPublish(hash, hash));
    for (const changed of [
        { ...baseline, scope: { ...baseline.scope, channel: 'b' } },
        { ...baseline, before: { ...baseline.before, updatedAt: 'v2' } },
        { ...baseline, before: { ...baseline.before, enabled: true } },
        { ...baseline, intended: { ...baseline.intended, title: 'Different code default' } },
        { ...baseline, intended: { ...baseline.intended, items: ['b', 'a'] } },
    ])
        assert.throws(() => assertReviewedStorefrontPublish(storefrontPublishReviewHash(changed), hash));
});
test('object key order does not invalidate a reviewed plan', () => {
    assert.equal(
        storefrontPublishReviewHash({ a: 1, b: { x: 2, y: 3 } }),
        storefrontPublishReviewHash({ b: { y: 3, x: 2 }, a: 1 }),
    );
});
