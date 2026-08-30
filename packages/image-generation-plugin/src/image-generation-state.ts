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
export type InterruptedImageStageAction = 'REQUEUE' | 'UNKNOWN' | 'SETTLE' | 'COMPLETE' | 'IGNORE';

export interface ImageOutputActivitySnapshot {
    state: string;
    unknownAt?: Date | null;
    updatedAt?: Date | null;
}

export interface ProviderCostTelemetrySnapshot {
    httpStatus?: number | null;
    providerRequestId?: string | null;
    latencyMs: number;
    actualCostMicrounits?: number | null;
    costCurrency?: string | null;
    usage?: unknown;
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

export function interruptedImageStageAction(
    stage: string | null | undefined,
    outputState: string,
): InterruptedImageStageAction {
    if (stage === 'SETTLED' || outputState === 'SUCCEEDED') return 'COMPLETE';
    if (outputState !== 'RUNNING') return 'IGNORE';
    if (stage === 'CLAIMED') return 'REQUEUE';
    if (stage === 'REQUEST_STARTED' || stage === 'RESPONSE_RECEIVED') return 'UNKNOWN';
    if (stage === 'ASSET_STORED') return 'SETTLE';
    return 'IGNORE';
}

export function imageOutboxRetryDelayMs(httpStatus?: number, retryAfterSeconds?: number): number {
    if (httpStatus === 401 || httpStatus === 403) return 0;
    return Math.min(300_000, Math.max(1, retryAfterSeconds ?? 60) * 1_000);
}

export function preserveProviderCostTelemetry<T extends ProviderCostTelemetrySnapshot>(
    existing: T,
    incoming: T,
): T {
    return {
        ...incoming,
        httpStatus: incoming.httpStatus ?? existing.httpStatus,
        providerRequestId: incoming.providerRequestId ?? existing.providerRequestId,
        latencyMs: Math.max(existing.latencyMs, incoming.latencyMs),
        actualCostMicrounits: incoming.actualCostMicrounits ?? existing.actualCostMicrounits,
        costCurrency: incoming.costCurrency ?? existing.costCurrency,
        usage: incoming.usage ?? existing.usage,
    };
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
