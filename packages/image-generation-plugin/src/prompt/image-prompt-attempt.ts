import { RequestContext, TransactionalConnection } from '@vendure/core';
import { randomUUID } from 'node:crypto';

import { ImagePromptOptimizationAttempt } from '../entities/image-prompt-optimization-attempt.entity';
import { ImagePromptOptimization } from '../entities/image-prompt-optimization.entity';
import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { ProviderPromptResult, ProviderTelemetry } from '../types';

export class ImageAttemptPersistenceError extends Error {
    constructor() {
        super('上游调用记录保存失败，已停止后续调用，费用待核对');
    }
}

export function traceValues(telemetry: ProviderTelemetry = {}) {
    return {
        callId: telemetry.callId?.slice(0, 36) ?? null,
        headerRequestId: telemetry.headerRequestId?.slice(0, 200) ?? null,
        headerRequestIdSource: telemetry.headerRequestIdSource?.slice(0, 48) ?? null,
        modelResponseId: telemetry.modelResponseId?.slice(0, 200) ?? null,
        costSource: telemetry.costSource?.slice(0, 32) ?? null,
        reportedCostEvidence: telemetry.reportedCostEvidence ?? null,
    };
}

/** Persist intent before sending; a crash leaves UNKNOWN, never proof of a free call. */
export async function runPromptAttempt(
    connection: TransactionalConnection,
    ctx: RequestContext,
    optimization: ImagePromptOptimization,
    credential: ImageProviderCredential,
    modelId: string,
    attemptNumber: number,
    stage: string,
    selectionReason: string | null,
    invoke: () => Promise<ProviderPromptResult>,
): Promise<ProviderPromptResult> {
    const repository = connection.getRepository(ctx, ImagePromptOptimizationAttempt);
    const callId = randomUUID();
    const startedAt = Date.now();
    const record = new ImagePromptOptimizationAttempt({
        channelId: ctx.channelId,
        optimizationIdSnapshot: String(optimization.id),
        callId,
        attemptNumber,
        stage,
        outcome: 'UNKNOWN',
        modelId,
        providerScope: credential.scope,
        credentialCodeSnapshot: credential.code,
        credentialNameSnapshot: credential.name,
        credentialLast4Snapshot: credential.apiKeyLast4,
        credentialSelectionReason: selectionReason,
        latencyMs: 0,
    });
    try {
        await repository.insert(record);
    } catch {
        throw new ImageAttemptPersistenceError();
    }
    let result: ProviderPromptResult | undefined;
    let failure: unknown;
    try {
        result = await invoke();
    } catch (error) {
        failure = error;
    }
    const telemetry: ProviderTelemetry = {
        ...(result?.telemetry ?? errorTelemetry(failure)),
        callId,
    };
    try {
        await repository.update(
            { callId, channelId: ctx.channelId },
            {
                ...traceValues(telemetry),
                callId,
                providerRequestId: telemetry.providerRequestId?.slice(0, 200) ?? null,
                httpStatus: telemetry.httpStatus ?? null,
                usage: telemetry.usage ?? null,
                actualCostMicrounits: telemetry.actualCostMicrounits ?? null,
                costCurrency: telemetry.costCurrency ?? null,
                outcome: result ? 'SUCCEEDED' : telemetry.httpStatus ? 'FAILED' : 'UNKNOWN',
                latencyMs: Math.min(2_147_483_647, Date.now() - startedAt),
                completedAt: new Date(),
                // Error bodies may contain private prompts. Store a classification only.
                errorMessage: result
                    ? null
                    : telemetry.httpStatus
                      ? `HTTP ${telemetry.httpStatus}`
                      : '响应未知',
            },
        );
    } catch {
        throw new ImageAttemptPersistenceError();
    }
    if (result) return { ...result, telemetry };
    throw failure;
}

function errorTelemetry(error: unknown): ProviderTelemetry {
    if (!error || typeof error !== 'object' || !('details' in error)) return {};
    return error.details && typeof error.details === 'object' ? error.details : {};
}
