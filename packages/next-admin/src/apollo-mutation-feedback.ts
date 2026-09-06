import { ApolloLink, Observable } from '@apollo/client';

import { isSensitiveActionCancelledError } from './apollo-sensitive-action';
import { createAdminFeedbackId, publishAdminFeedback } from './utils/admin-feedback';
import {
    extractMutationFailure,
    getMutationFeedbackCopy,
    hasChineseSaveInput,
    isMutationDocument,
    type AdminMutationFeedbackContext,
    type AdminMutationFeedbackOptions,
} from './utils/admin-mutation-feedback';
import { toUserFacingError } from './utils/user-facing-error';

interface GraphqlResultWithErrors {
    errors?: ReadonlyArray<{ message?: string }>;
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
    const copy = getMutationFeedbackCopy(operation.operationName, options);
    const feedbackId = createAdminFeedbackId(operation.operationName || 'admin-mutation');

    // 仅保留错误反馈时，不显示一个无法在成功后关闭的 loading 通知。
    if (!options.skipPending && !options.skipSuccess) {
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
            if (isSensitiveActionCancelledError(reason)) {
                publishAdminFeedback({
                    id: feedbackId,
                    kind: 'info',
                    title: '操作已取消',
                });
                return;
            }
            publishAdminFeedback({
                id: feedbackId,
                kind: 'error',
                title: `${copy.action}失败`,
                message: toUserFacingError(reason, copy.failure),
            });
        };

        const subscription = forward(operation).subscribe({
            next: result => {
                const graphqlErrors = (result as GraphqlResultWithErrors).errors;
                if (graphqlErrors?.length) {
                    finishWithError(graphqlErrors[0]?.message);
                } else {
                    const businessFailure =
                        result.data == null ? '管理服务未返回操作结果' : extractMutationFailure(result.data);
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
