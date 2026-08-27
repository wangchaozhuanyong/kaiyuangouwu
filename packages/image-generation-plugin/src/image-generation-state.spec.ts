import { describe, expect, it } from 'vitest';

import { decideImageOutputFailure, deriveImageJobSettlement } from './image-generation-state';

describe('deriveImageJobSettlement', () => {
    it('prioritizes active and unknown output states', () => {
        expect(
            deriveImageJobSettlement(3, 120, [
                { state: 'SUCCEEDED' },
                { state: 'UNKNOWN' },
                { state: 'RUNNING' },
            ]),
        ).toEqual({ state: 'RUNNING', capturedAmount: 120, releasedAmount: 0, terminal: false });
        expect(deriveImageJobSettlement(2, 120, [{ state: 'SUCCEEDED' }, { state: 'UNKNOWN' }]).state).toBe(
            'UNKNOWN',
        );
        expect(deriveImageJobSettlement(2, 120, [{ state: 'SUCCEEDED' }, { state: 'QUEUED' }]).state).toBe(
            'QUEUED',
        );
    });

    it('charges only successful outputs and releases failed or cancelled outputs', () => {
        expect(
            deriveImageJobSettlement(4, 150, [
                { state: 'SUCCEEDED' },
                { state: 'SUCCEEDED' },
                { state: 'FAILED' },
                { state: 'CANCELLED' },
            ]),
        ).toEqual({
            state: 'PARTIAL_SUCCESS',
            capturedAmount: 300,
            releasedAmount: 300,
            terminal: true,
        });
    });

    it('keeps generation success after an administrative refund', () => {
        expect(
            deriveImageJobSettlement(2, 200, [
                { state: 'SUCCEEDED', refundedAt: new Date() },
                { state: 'SUCCEEDED' },
            ]),
        ).toEqual({
            state: 'SUCCEEDED',
            capturedAmount: 200,
            releasedAmount: 200,
            terminal: true,
        });
    });

    it('distinguishes all-cancelled from failed jobs', () => {
        expect(deriveImageJobSettlement(2, 100, [{ state: 'CANCELLED' }, { state: 'CANCELLED' }])).toEqual({
            state: 'CANCELLED',
            capturedAmount: 0,
            releasedAmount: 200,
            terminal: true,
        });
        expect(deriveImageJobSettlement(2, 100, [{ state: 'FAILED' }, { state: 'CANCELLED' }]).state).toBe(
            'FAILED',
        );
    });
});

describe('decideImageOutputFailure', () => {
    it('retries only retryable failures within the configured retry budget', () => {
        expect(decideImageOutputFailure({ retryable: true, ambiguous: false, attempts: 1, retries: 2 })).toBe(
            'RETRY',
        );
        expect(decideImageOutputFailure({ retryable: true, ambiguous: false, attempts: 2, retries: 2 })).toBe(
            'RETRY',
        );
        expect(decideImageOutputFailure({ retryable: true, ambiguous: false, attempts: 3, retries: 2 })).toBe(
            'FAIL',
        );
    });

    it('holds ambiguous network outcomes for reconciliation instead of retrying', () => {
        expect(decideImageOutputFailure({ retryable: false, ambiguous: true, attempts: 1, retries: 2 })).toBe(
            'UNKNOWN',
        );
        expect(
            decideImageOutputFailure({ retryable: false, ambiguous: false, attempts: 1, retries: 2 }),
        ).toBe('FAIL');
    });
});
