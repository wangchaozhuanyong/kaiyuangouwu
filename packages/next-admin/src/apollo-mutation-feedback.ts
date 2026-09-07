import { ApolloLink, Observable } from '@apollo/client';

import { isSensitiveActionCancelledError } from './apollo-sensitive-action';
import { createAdminFeedbackId, publishAdminFeedback } from './utils/admin-feedback';
import {
    extractMutationFailureDetails,
    getMutationFeedbackCopy,
    hasChineseSaveInput,
    isMutationDocument,
    type AdminMutationFeedbackContext,
    type AdminMutationFeedbackOptions,
} from './utils/admin-mutation-feedback';
import { normalizeOperationFailure } from './utils/operation-failure';

interface GraphqlResultWithErrors {
    errors?: ReadonlyArray<{
        message?: string;
        extensions?: Readonly<Record<string, unknown>>;
    }>;
}

/**
 * 所有后台 mutation 的统一反馈兜底。页面仍可保留更详细的行内提示，
 * 特殊操作可通过 context.adminFeedback=false 关闭全局反馈。
 */
export const adminMutationFeedbackLink = new ApolloLink((operation, forward) => {
    if (!isMutationDocument(operation.query, operation.operationName)) return forward(operation);

    const feedbackContext = operation.getContext().adminFeedback as AdminMutationFeedbackContext | undefined;
    if (feedbackContext === false) return forward(operation);

    const options: AdminMutationFeedbackOptions = feedbackContext ?? {};
    const copy = getMutationFeedbackCopy(operation.operationName, options, operation.variables);
    const feedbackId = createAdminFeedbackId(operation.operationName || 'admin-mutation');

    // 仅保留错误反馈时，不显示一个无法在成功后关闭的 loading 通知。
    if (!options.skipPending && !options.skipSuccess && !options.skipError) {
        publishAdminFeedback({
            id: feedbackId,
            kind: 'loading',
            title: copy.pending,
            message: '正在等待管理服务返回结果，请勿重复提交',
        });
    }

    return new Observable(observer => {
        let completedFeedback = false;
        const finishWithError = (reason: unknown) => {
            if (completedFeedback) return;
            completedFeedback = true;
            if (options.skipError) return;
            if (isSensitiveActionCancelledError(reason)) {
                publishAdminFeedback({
                    id: feedbackId,
                    kind: 'info',
                    title: '操作已取消',
                });
                return;
            }
            const failure = normalizeOperationFailure(reason, {
                fallbackReason: copy.failure,
                fallbackResolution: copy.resolution,
                referenceId: feedbackId,
            });
            const details = [...(copy.details ?? []), ...(failure.details ?? [])];
            publishAdminFeedback({
                id: feedbackId,
                kind: 'error',
                title: `${copy.action}${copy.target ?? ''}失败`,
                message: failure.reason,
                reason: failure.reason,
                ...(details.length ? { details: [...new Set(details)] } : {}),
                resolution: failure.resolution,
                retryable: failure.retryable,
                ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
                ...(failure.traceId ? { traceId: failure.traceId } : {}),
            });
        };

        const subscription = forward(operation).subscribe({
            next: result => {
                const graphqlErrors = (result as GraphqlResultWithErrors).errors;
                if (graphqlErrors?.length) {
                    finishWithError(graphqlErrors[0]);
                } else {
                    const businessFailure =
                        result.data == null
                            ? { message: '管理服务未返回操作结果' }
                            : extractMutationFailureDetails(result.data);
                    if (businessFailure) {
                        finishWithError(businessFailure);
                    } else if (!completedFeedback && !options.skipSuccess) {
                        completedFeedback = true;
                        publishAdminFeedback({
                            id: feedbackId,
                            kind: 'success',
                            title: copy.success,
                            ...(hasChineseSaveInput(operation.operationName, operation.variables)
                                ? { message: '中文已保存，英文待同步；人工锁定的英文会保留' }
                                : {}),
                        });
                    }
                }
                observer.next(result);
            },
            error: error => {
                finishWithError(error);
                observer.error(error);
            },
            complete: () => observer.complete(),
        });

        return () => subscription.unsubscribe();
    });
});
