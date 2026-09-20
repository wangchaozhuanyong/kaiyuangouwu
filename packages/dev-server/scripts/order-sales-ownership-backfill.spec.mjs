import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOrderSalesOwnershipPlan, operationDigest } from './order-sales-ownership-backfill.mjs';

void test('assigns default-only orders to default and prefers one non-default membership', () => {
    const plan = buildOrderSalesOwnershipPlan([
        { orderId: 2, channelId: 1, channelCode: '__default_channel__' },
        { orderId: 2, channelId: 3, channelCode: 'moyao-ai' },
        { orderId: 1, channelId: 1, channelCode: '__default_channel__' },
    ]);
    assert.deepEqual(plan.countsByChannel, { __default_channel__: 1, 'moyao-ai': 1 });
    assert.equal(plan.candidateCount, 2);
    assert.deepEqual(plan.operations, [
        { orderId: '1', channelId: '1', channelCode: '__default_channel__' },
        { orderId: '2', channelId: '3', channelCode: 'moyao-ai' },
    ]);
    assert.equal(plan.operationDigest, operationDigest(plan.operations));
    assert.match(plan.operationDigest, /^[a-f0-9]{64}$/u);
});

void test('rejects orders without membership or with multiple non-default memberships', () => {
    assert.throws(
        () => buildOrderSalesOwnershipPlan([{ orderId: 1, channelId: null, channelCode: null }]),
        /no Channel membership/u,
    );
    assert.throws(
        () =>
            buildOrderSalesOwnershipPlan([
                { orderId: 1, channelId: 2, channelCode: 'store-a' },
                { orderId: 1, channelId: 3, channelCode: 'store-b' },
            ]),
        /multiple non-default/u,
    );
});
