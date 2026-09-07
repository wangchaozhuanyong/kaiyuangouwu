import { createAdminFeedbackId, publishAdminFeedback } from './admin-feedback';
import { toUserFacingError } from './user-facing-error';

export interface VerifiedMutationOptions<T> {
    action: string;
    successMessage: string;
    failureMessage: string;
    mutate: () => Promise<T>;
    verify: (result: T) => Promise<void> | void;
}

/**
 * Runs settings mutations whose success must be confirmed against the returned or re-fetched state.
 * The regular Apollo success feedback must be disabled for the wrapped mutation so that a transport-level
 * response cannot be mistaken for a persisted business change.
 */
export async function runVerifiedMutation<T>({
    action,
    successMessage,
    failureMessage,
    mutate,
    verify,
}: VerifiedMutationOptions<T>): Promise<T> {
    const feedbackId = createAdminFeedbackId(`verified-${action}`);
    publishAdminFeedback({
        id: feedbackId,
        kind: 'loading',
        title: `${action}中…`,
        message: '正在保存并从服务端回读校验，请勿重复提交',
    });

    try {
        const result = await mutate();
        await verify(result);
        publishAdminFeedback({
            id: feedbackId,
            kind: 'success',
            title: `${action}成功`,
            message: successMessage,
        });
        return result;
    } catch (error) {
        publishAdminFeedback({
            id: feedbackId,
            kind: 'error',
            title: `${action}失败`,
            message: toUserFacingError(error, failureMessage),
        });
        throw error;
    }
}
