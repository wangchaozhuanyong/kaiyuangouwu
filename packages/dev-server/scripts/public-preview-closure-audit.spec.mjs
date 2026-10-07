import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    classifySimulationPayments,
    collectPublicPreviewClosureAudit,
} from './public-preview-closure-audit.mjs';

const testPayment = {
    id: 1,
    method: 'controlled-test-payment-platform',
    state: 'Settled',
    metadata: JSON.stringify({ public: { testPayment: true } }),
};

test('only double identified completed simulation is reviewable', () => {
    assert.equal(classifySimulationPayments([testPayment]).status, 'TEST_ONLY_REVIEWABLE');
    assert.equal(
        classifySimulationPayments([{ ...testPayment, metadata: '{}' }]).status,
        'REQUIRES_PAYMENT_RECONCILIATION',
    );
    assert.equal(
        classifySimulationPayments([{ ...testPayment, method: 'usdt-trc20' }]).status,
        'REQUIRES_PAYMENT_RECONCILIATION',
    );
});

test('unknown or real mixed payments never qualify for compensation', () => {
    for (const other of [
        { ...testPayment, id: 2, state: 'Created' },
        { ...testPayment, id: 2, method: 'usdt-trc20', metadata: '{}' },
        { ...testPayment, id: 2, state: 'Unrecognized' },
        { ...testPayment, id: 2, state: 'Error' },
        { ...testPayment, metadata: { public: { testPayment: true }, manualReview: { required: true } } },
    ]) {
        assert.equal(
            classifySimulationPayments([testPayment, other]).status,
            'REQUIRES_PAYMENT_RECONCILIATION',
        );
    }
});

test('declines contain no funds but do not prove a completed simulation', () => {
    const declined = { ...testPayment, id: 2, method: 'usdt-trc20', state: 'Declined' };
    assert.equal(classifySimulationPayments([testPayment, declined]).status, 'TEST_ONLY_REVIEWABLE');
    assert.equal(classifySimulationPayments([declined]).status, 'REQUIRES_PAYMENT_RECONCILIATION');
});

test('audit returns unknown rather than zero when schema cannot be verified', async () => {
    const result = await collectPublicPreviewClosureAudit({
        tableExists: async () => false,
        query: async () => {
            throw new Error('must not query unknown schema');
        },
    });
    assert.equal(result.status, 'UNVERIFIED_SCHEMA');
    assert.equal(result.compensation, null);
});

test('audit SELECTs only and rejects mismatched resource ownership', async () => {
    const result = await collectPublicPreviewClosureAudit({
        tableExists: async () => true,
        columnExists: async () => true,
        query: async (sql, params) => {
            assert.match(sql, /^SELECT /);
            if (sql.includes('FROM store_profile'))
                return [
                    {
                        id: 3,
                        channelId: 5,
                        status: 'DRAFT',
                        isPublished: 0,
                        updatedAt: '2026-10-03T05:38:20.000Z',
                        primaryDomain: 'moyaoai.com',
                    },
                ];
            if (sql.includes('FROM `order`')) return [{ id: 10, salesChannelId: 5, state: 'PaymentSettled' }];
            assert.deepEqual(params, [10]);
            if (sql.includes('FROM payment')) return [testPayment];
            if (sql.includes('FROM checkout_resource_hold'))
                return [{ id: 20, channelId: 2, state: 'CONFIRMED' }];
            return [];
        },
    });
    assert.equal(result.transition[0].expectedUpdatedAt, '2026-10-03T05:38:20.000Z');
    assert.equal(result.compensation[0].status, 'REQUIRES_OWNERSHIP_RECONCILIATION');
    assert.equal(JSON.stringify(result).includes('testPayment":true'), false);
});
