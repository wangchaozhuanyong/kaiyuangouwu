import { createAdminFeedbackId, publishAdminFeedback } from './admin-feedback';
import { normalizeOperationFailure } from './operation-failure';

export interface AdminActionFeedbackOptions {
    action: string;
    target?: string;
    pending?: string;
    success?: string;
    failure?: string;
    details?: string[];
    resolution?: string[];
    feedbackId?: string;
    skipPending?: boolean;
    skipSuccess?: boolean;
    preferFailureReason?: boolean;
}

export async function runAdminActionWithFeedback<T>(
    options: AdminActionFeedbackOptions,
    execute: () => Promise<T>,
): Promise<T> {
    const feedbackId = options.feedbackId ?? createAdminFeedbackId('admin-action');
    if (!options.skipPending) {
        publishAdminFeedback({
            id: feedbackId,
            kind: 'loading',
            title: options.pending ?? `${options.action}中…`,
            message: '正在等待管理服务返回结果，请勿重复提交',
        });
    }

    try {
        const result = await execute();
        if (!options.skipSuccess) {
            publishAdminFeedback({
                id: feedbackId,
                kind: 'success',
                title: options.success ?? `${options.action}成功`,
            });
        }
        return result;
    } catch (error) {
        publishAdminOperationFailure(error, { ...options, feedbackId });
        throw error;
    }
}

export function publishAdminOperationFailure(error: unknown, options: AdminActionFeedbackOptions) {
    const feedbackId = options.feedbackId ?? createAdminFeedbackId('admin-action');
    const failure = normalizeOperationFailure(error, {
        fallbackReason: options.failure,
        fallbackResolution: options.resolution,
        referenceId: feedbackId,
        preferFallbackReason: options.preferFailureReason,
    });
    const details = [...(options.details ?? []), ...(failure.details ?? [])];
    publishAdminFeedback({
        id: feedbackId,
        kind: 'error',
        title: `${options.action}${options.target ?? ''}失败`,
        message: failure.reason,
        reason: failure.reason,
        ...(details.length ? { details: [...new Set(details)] } : {}),
        resolution: failure.resolution,
        retryable: failure.retryable,
        ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
        ...(failure.traceId ? { traceId: failure.traceId } : {}),
    });
    return feedbackId;
}
