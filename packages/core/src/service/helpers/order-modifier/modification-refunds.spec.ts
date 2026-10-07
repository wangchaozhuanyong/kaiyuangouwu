import { RefundOrderInput, RefundReasonType } from '@vendure/common/lib/generated-types';
import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';

import { buildModificationRefunds, prepareModificationRefunds } from './modification-refunds';
const units = [{ orderLineId: 'line-1', quantity: 1 }];
function source(paymentId: string, amount: number, lines = units): RefundOrderInput {
    return { paymentId, amount, reason: 'Modification', lines, shipping: 0, adjustment: 0 };
}
describe('order modification refund assembly', () => {
    const version = { id: 'order-1', updatedAt: new Date('2026-10-04T00:00:00Z'), totalWithTax: 1000 };
    it('keeps a caller request key and the after-sales reference through modification assembly', () => {
        const prepared = prepareModificationRefunds(
            [
                {
                    paymentId: 'payment-1',
                    amount: 500,
                    idempotencyKey: 'submission-1',
                    afterSalesId: 'review-1',
                },
            ],
            version,
        );
        expect(prepared[0]).toMatchObject({ idempotencyKey: 'submission-1', afterSalesId: 'review-1' });
        const first = buildModificationRefunds(prepared, 500, 0);
        const retry = buildModificationRefunds(
            prepareModificationRefunds(
                [
                    {
                        paymentId: 'payment-1',
                        amount: 500,
                        idempotencyKey: 'submission-1',
                        afterSalesId: 'review-1',
                    },
                ],
                { ...version, totalWithTax: 1500 },
            ),
            500,
            0,
        );
        expect(retry[0].idempotencyKey).toBe(first[0].idempotencyKey);
        expect(first[0].afterSalesId).toBe('review-1');
    });
    it('keeps legacy retries stable and separates later equal-value price reductions', () => {
        const inputs = [{ paymentId: 'payment-1', amount: 100, reason: 'same note' }];
        const first = prepareModificationRefunds(inputs, version);
        const retry = prepareModificationRefunds(inputs, { ...version });
        const next = prepareModificationRefunds(inputs, {
            ...version,
            totalWithTax: 900,
            updatedAt: new Date('2026-10-04T00:00:01Z'),
        });
        expect(retry[0].idempotencyKey).toBe(first[0].idempotencyKey);
        expect(next[0].idempotencyKey).not.toBe(first[0].idempotencyKey);
    });
    it('keeps separately split purposes distinct and within the request-key length limit', () => {
        const prepared = prepareModificationRefunds(
            [{ paymentId: 'payment-1', amount: 600, idempotencyKey: 'a'.repeat(128) }],
            version,
        );
        prepared[0].lines = units;
        const requests = buildModificationRefunds(prepared, 600, 100);
        expect(requests[0].idempotencyKey).not.toBe(requests[1].idempotencyKey);
        expect(requests.every(request => requireFixture(request.idempotencyKey).length <= 128)).toBe(true);
    });
    it('rejects invalid caller request keys before a provider can be called', () => {
        expect(() =>
            prepareModificationRefunds([{ paymentId: 'payment-1', idempotencyKey: '' }], version),
        ).toThrow('编号格式');
    });
    it('splits removed items and shipping into independent truthful refund purposes', () => {
        const requests = buildModificationRefunds([source('payment-1', 600)], 600, 100);
        expect(requests).toMatchObject([
            { paymentId: 'payment-1', amount: 500, shipping: 0, reasonType: 'ITEMS', lines: units },
            { paymentId: 'payment-1', amount: 100, shipping: 100, reasonType: 'SHIPPING', lines: [] },
        ]);
    });
    it('places all reduced item units on one sufficient source without copying them across payments', () => {
        const requests = buildModificationRefunds(
            [source('small-source', 100), source('item-source', 500)],
            600,
            100,
        );
        expect(requests.filter(request => request.reasonType === RefundReasonType.ITEMS)).toMatchObject([
            { paymentId: 'item-source', amount: 500, lines: units },
        ]);
        expect(requests.filter(request => request.reasonType === RefundReasonType.SHIPPING)).toMatchObject([
            { paymentId: 'small-source', amount: 100, shipping: 100, lines: [] },
        ]);
        expect(requests.some(request => request.reasonType === RefundReasonType.COMPENSATION)).toBe(false);
    });
    it('splits item money across original payments while counting the removed unit only once', () => {
        const requests = buildModificationRefunds(
            [source('payment-1', 250), source('payment-2', 250)],
            500,
            0,
        );
        expect(requests).toHaveLength(2);
        expect(requests.every(request => request.reasonType === RefundReasonType.ITEMS)).toBe(true);
        expect(requests.flatMap(request => request.lines ?? [])).toEqual(units);
        expect(requests.map(request => request.amount)).toEqual([250, 250]);
    });
    it('uses compensation only for a price adjustment without quantity reductions', () => {
        const requests = buildModificationRefunds(
            [source('payment-1', 200, []), source('payment-2', 200, [])],
            400,
            0,
        );
        expect(requests).toHaveLength(2);
        expect(
            requests.every(
                request =>
                    request.reasonType === RefundReasonType.COMPENSATION && request.lines?.length === 0,
            ),
        ).toBe(true);
    });
    it('rejects a refund total differing from the price change', () => {
        expect(() => buildModificationRefunds([source('payment-1', 499)], 500, 0)).toThrow('总额必须等于');
    });
    it('keeps zero-price removed goods out of monetary shipping refunds', () => {
        expect(buildModificationRefunds([source('payment-1', 100)], 100, 100)).toMatchObject([
            { reasonType: 'SHIPPING', amount: 100, shipping: 100, lines: [] },
        ]);
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
