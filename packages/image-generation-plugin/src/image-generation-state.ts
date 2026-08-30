import { ImageGenerationState } from './types';

export interface ImageOutputSettlementSnapshot {
    state: string;
    refundedAt?: Date | null;
    chargeAmount?: number;
}

export interface ImageJobSettlementSummary {
    state: ImageGenerationState;
    capturedAmount: number;
    releasedAmount: number;
    terminal: boolean;
}

export type ImageOutputFailureDecision = 'RETRY' | 'UNKNOWN' | 'FAIL';

export interface ImageOutputActivitySnapshot {
    state: string;
    unknownAt?: Date | null;
    updatedAt?: Date | null;
}

export function hasStaleImageOutput(outputs: readonly ImageOutputActivitySnapshot[], cutoff: Date): boolean {
    return outputs.some(output => {
        if (!['RUNNING', 'UNKNOWN'].includes(output.state)) return false;
        const activityAt =
            output.state === 'UNKNOWN' ? (output.unknownAt ?? output.updatedAt) : output.updatedAt;
        return activityAt != null && activityAt.getTime() <= cutoff.getTime();
    });
}

export function decideImageOutputFailure(input: {
    retryable: boolean;
    ambiguous: boolean;
    attempts: number;
    retries: number;
}): ImageOutputFailureDecision {
    if (input.retryable && input.attempts <= input.retries) return 'RETRY';
    if (input.ambiguous) return 'UNKNOWN';
    return 'FAIL';
}

/**
 * Derives the parent job from immutable per-output facts. A refund changes the
 * financial totals, but it does not turn a technically successful generation
 * into a failed generation.
 */
export function deriveImageJobSettlement(
    quantity: number,
    unitPrice: number,
    outputs: readonly ImageOutputSettlementSnapshot[],
    expectedChargeAmount = quantity * unitPrice,
): ImageJobSettlementSummary {
    const states = outputs.map(output => output.state);
    const successCount = outputs.filter(output => output.state === 'SUCCEEDED').length;
    const capturedAmount = outputs.reduce(
        (sum, output) =>
            sum +
            (output.state === 'SUCCEEDED' && !output.refundedAt ? (output.chargeAmount ?? unitPrice) : 0),
        0,
    );

    let state: ImageGenerationState;
    if (states.some(value => value === 'RUNNING')) state = 'RUNNING';
    else if (states.some(value => value === 'UNKNOWN')) state = 'UNKNOWN';
    else if (states.some(value => value === 'QUEUED')) state = 'QUEUED';
    else if (successCount === quantity && outputs.length === quantity) state = 'SUCCEEDED';
    else if (successCount > 0) state = 'PARTIAL_SUCCESS';
    else if (
        outputs.length === quantity &&
        outputs.length > 0 &&
        states.every(value => value === 'CANCELLED')
    ) {
        state = 'CANCELLED';
    } else state = 'FAILED';

    return {
        state,
        capturedAmount,
        releasedAmount: ['SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'].includes(state)
            ? Math.max(0, expectedChargeAmount - capturedAmount)
            : 0,
        terminal: ['SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'].includes(state),
    };
}
