import { ImageGenerationState } from './types';

export interface ImageOutputSettlementSnapshot {
    state: string;
    refundedAt?: Date | null;
}

export interface ImageJobSettlementSummary {
    state: ImageGenerationState;
    capturedAmount: number;
    releasedAmount: number;
    terminal: boolean;
}

export type ImageOutputFailureDecision = 'RETRY' | 'UNKNOWN' | 'FAIL';

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
): ImageJobSettlementSummary {
    const states = outputs.map(output => output.state);
    const successCount = outputs.filter(output => output.state === 'SUCCEEDED').length;
    const refundedSuccessCount = outputs.filter(
        output => output.state === 'SUCCEEDED' && Boolean(output.refundedAt),
    ).length;
    const billableSuccessCount = successCount - refundedSuccessCount;
    const unsuccessfulCount = states.filter(outputState =>
        ['FAILED', 'CANCELLED'].includes(outputState),
    ).length;

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
        capturedAmount: billableSuccessCount * unitPrice,
        releasedAmount: (unsuccessfulCount + refundedSuccessCount) * unitPrice,
        terminal: ['SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'].includes(state),
    };
}
