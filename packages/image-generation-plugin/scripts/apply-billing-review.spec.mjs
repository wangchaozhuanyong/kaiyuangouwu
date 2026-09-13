import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it as test } from 'vitest';

import {
    billingReviewConnectionOptions,
    parseBillingReviewArguments,
    verifyBillingReviewManifest,
} from './apply-billing-review.mjs';

test('operator tool defaults to dry-run and requires explicit output ownership', () => {
    const parsed = parseBillingReviewArguments([
        '--manifest',
        '/project/review.json',
        '--output',
        '/project/result.json',
    ]);
    assert.equal(parsed.apply, false);
    assert.throws(() =>
        parseBillingReviewArguments(['--manifest', 'relative.json', '--output', '/project/result.json']),
    );
    assert.throws(() =>
        parseBillingReviewArguments([
            '--manifest',
            '/project/review.json',
            '--output',
            '/project/result.json',
            '--apply',
        ]),
    );
    assert.throws(() =>
        parseBillingReviewArguments([
            '--manifest',
            '/project/review.json',
            '--output',
            '/project/result.json',
            '--unknown',
        ]),
    );
});
test('confirmed manifest digest cannot silently change and target IDs cannot repeat', () => {
    const target = { channelId: '1', recordType: 'IMAGE_COST_EVENT', recordId: '1' };
    const bytes = Buffer.from(JSON.stringify({ version: 1, reviews: [target] }));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
        verifyBillingReviewManifest(bytes, { apply: true, 'confirm-manifest-sha': digest }).digest,
        digest,
    );
    assert.throws(() =>
        verifyBillingReviewManifest(bytes, { apply: true, 'confirm-manifest-sha': '0'.repeat(64) }),
    );
    assert.throws(() =>
        verifyBillingReviewManifest(
            Buffer.from(JSON.stringify({ version: 1, reviews: [target, target] })),
            {},
        ),
    );
});
test('remote connections need the explicit guard and never enable automatic migration', () => {
    const env = {
        DB_HOST: 'remote.invalid',
        DB_NAME: 'fixture',
        DB_USERNAME: 'fixture',
        DB_PASSWORD: 'fixture',
    };
    assert.throws(() => billingReviewConnectionOptions(env, {}));
    const options = billingReviewConnectionOptions(env, { 'allow-remote': true });
    assert.equal(options.synchronize, false);
    assert.equal(options.migrationsRun, false);
});

test('a batch cannot assign the same supplier bill to two targets', () => {
    const first = {
        channelId: '1',
        recordType: 'IMAGE_COST_EVENT',
        recordId: '1',
        bills: [{ supplierScope: 'fixture-account', billId: 'fixture-bill' }],
    };
    const second = { ...first, recordId: '2' };
    assert.throws(
        () =>
            verifyBillingReviewManifest(
                Buffer.from(JSON.stringify({ version: 1, reviews: [first, second] })),
                {},
            ),
        /一张账单/,
    );
});
