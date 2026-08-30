import { describe, expect, it } from 'vitest';

import {
    decideImageOutputFailure,
    deriveImageJobSettlement,
    hasStaleImageOutput,
    imageOutboxRetryDelayMs,
    interruptedImageStageAction,
    preserveProviderCostTelemetry,
} from './image-generation-state';

describe('hasStaleImageOutput', () => {
    const cutoff = new Date('2026-08-30T05:00:00.000Z');

    it('detects stale running and unknown outputs', () => {
        expect(
            hasStaleImageOutput(
                [{ state: 'RUNNING', updatedAt: new Date('2026-08-30T04:59:00.000Z') }],
                cutoff,
            ),
        ).toBe(true);
        expect(
            hasStaleImageOutput(
                [{ state: 'UNKNOWN', unknownAt: new Date('2026-08-30T04:59:00.000Z') }],
                cutoff,
            ),
        ).toBe(true);
    });

    it('falls back to updatedAt for legacy unknown rows and ignores fresh or terminal outputs', () => {
        expect(
            hasStaleImageOutput(
                [{ state: 'UNKNOWN', unknownAt: null, updatedAt: new Date('2026-08-30T04:59:00.000Z') }],
                cutoff,
            ),
        ).toBe(true);
        expect(
            hasStaleImageOutput(
                [
                    { state: 'UNKNOWN', unknownAt: new Date('2026-08-30T05:01:00.000Z') },
                    { state: 'SUCCEEDED', updatedAt: new Date('2026-08-30T04:00:00.000Z') },
                ],
                cutoff,
            ),
        ).toBe(false);
    });
});

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

describe('interrupted image generation recovery', () => {
    it('only retries before the provider request and never retries an unknown provider result', () => {
        expect(interruptedImageStageAction('CLAIMED', 'RUNNING')).toBe('REQUEUE');
        expect(interruptedImageStageAction('REQUEST_STARTED', 'RUNNING')).toBe('UNKNOWN');
        expect(interruptedImageStageAction('RESPONSE_RECEIVED', 'RUNNING')).toBe('UNKNOWN');
        expect(interruptedImageStageAction('ASSET_STORED', 'RUNNING')).toBe('SETTLE');
        expect(interruptedImageStageAction('SETTLED', 'SUCCEEDED')).toBe('COMPLETE');
    });

    it('honors Retry-After, caps 429 delay and switches immediately after auth failures', () => {
        expect(imageOutboxRetryDelayMs(429, 17)).toBe(17_000);
        expect(imageOutboxRetryDelayMs(429, 900)).toBe(300_000);
        expect(imageOutboxRetryDelayMs(401, 120)).toBe(0);
        expect(imageOutboxRetryDelayMs(403)).toBe(0);
    });

    it('keeps provider telemetry when settlement recovery only changes the outcome', () => {
        expect(
            preserveProviderCostTelemetry(
                {
                    httpStatus: 200,
                    providerRequestId: 'request-1',
                    latencyMs: 53_700,
                    actualCostMicrounits: 125_000,
                    costCurrency: 'USD',
                    usage: { images: 1 },
                },
                {
                    httpStatus: null,
                    providerRequestId: null,
                    latencyMs: 0,
                    actualCostMicrounits: null,
                    costCurrency: null,
                    usage: null,
                },
            ),
        ).toEqual({
            httpStatus: 200,
            providerRequestId: 'request-1',
            latencyMs: 53_700,
            actualCostMicrounits: 125_000,
            costCurrency: 'USD',
            usage: { images: 1 },
        });
    });
});
