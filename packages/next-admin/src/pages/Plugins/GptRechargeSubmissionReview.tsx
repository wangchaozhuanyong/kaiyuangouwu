import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useId, useRef, useState } from 'react';

import { getAdminQueryScope } from '../../apollo';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { useAdminLazyQuery } from '../../hooks/use-admin-query';

type Review = { pending: boolean; revision: number };
type InspectedReview = Review & { code: string };
type Feedback = { message: string; failed?: boolean };

const SUBMISSION_REVIEW = gql`
    query GptRechargeSubmissionReview($code: String!) {
        gptRechargeSubmissionReview(code: $code) {
            pending
            revision
        }
    }
`;
const RECOVER_SUBMISSION = gql`
    mutation RecoverGptRechargeSubmission($code: String!, $expectedRevision: Int!) {
        recoverGptRechargeSubmission(code: $code, expectedRevision: $expectedRevision) {
            pending
            revision
        }
    }
`;

export function GptRechargeSubmissionReview({ scope }: { scope: string }) {
    const titleId = useId();
    const confirm = useConfirmDialog();
    const operation = useRef(false);
    const [code, setCode] = useState('');
    const [review, setReview] = useState<InspectedReview>();
    const [feedback, setFeedback] = useState<Feedback>();
    const [confirming, setConfirming] = useState(false);
    // Query variables contain a redeemable code, so the lookup must not write to Apollo's cache.
    const [inspect, lookupQuery] = useAdminLazyQuery<
        { gptRechargeSubmissionReview: Review },
        { code: string }
    >(SUBMISSION_REVIEW, { fetchPolicy: 'no-cache' });
    const [recover, recovery] = useMutation<
        { recoverGptRechargeSubmission: Review },
        { code: string; expectedRevision: number }
    >(RECOVER_SUBMISSION, { fetchPolicy: 'no-cache', context: { adminFeedback: false } });
    const checking = lookupQuery.loading;
    const busy = checking || confirming || recovery.loading;

    const lookup = async () => {
        const originalCode = code.trim();
        if (!originalCode || operation.current || getAdminQueryScope() !== scope) return;
        operation.current = true;
        setReview(undefined);
        setFeedback(undefined);
        try {
            const { data } = await inspect({ variables: { code: originalCode } });
            if (getAdminQueryScope() !== scope) return;
            const result = data?.gptRechargeSubmissionReview;
            if (!result) throw new Error('Missing submission review');
            setReview({ ...result, code: originalCode });
            setFeedback({
                message: result.pending ? '找到待核对的受理记录。' : '当前没有可解除的待核对记录。',
            });
        } catch {
            if (getAdminQueryScope() === scope)
                setFeedback({ message: '暂时无法核对，请检查原兑换码后重新查询。', failed: true });
        } finally {
            operation.current = false;
        }
    };

    const release = async () => {
        if (
            !review?.pending ||
            review.code !== code.trim() ||
            operation.current ||
            getAdminQueryScope() !== scope
        )
            return;
        operation.current = true;
        setConfirming(true);
        try {
            const confirmed = await confirm({
                title: '确认核对并解除锁定',
                description:
                    '系统会核对原受理记录。只有确认未受理才会解除锁定，用户之后可用原兑换码重新发起。本次操作不会提交充值。',
                confirmLabel: '核对并解除',
                tone: 'warning',
            });
            if (!confirmed || getAdminQueryScope() !== scope) return;
            setFeedback(undefined);
            const { data } = await recover({
                variables: { code: review.code, expectedRevision: review.revision },
            });
            if (getAdminQueryScope() !== scope) return;
            if (!data?.recoverGptRechargeSubmission || data.recoverGptRechargeSubmission.pending)
                throw new Error('Unconfirmed release');
            setCode('');
            setReview(undefined);
            setFeedback({ message: '已确认原请求未受理，已解除锁定。用户可用原兑换码重新发起。' });
        } catch {
            if (getAdminQueryScope() === scope) {
                setReview(undefined);
                setFeedback({
                    message: '暂时无法确认已解除锁定。记录可能已更新或上游尚未确认，请重新核对原兑换码。',
                    failed: true,
                });
            }
        } finally {
            operation.current = false;
            setConfirming(false);
        }
    };

    return (
        <section aria-labelledby={titleId} className="recharge-settings-sheet space-y-4 p-5 sm:p-6">
            <header className="space-y-1">
                <h2
                    id={titleId}
                    className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900"
                >
                    普通码待核对恢复
                    <FeatureHelpButton
                        title="普通码待核对恢复"
                        description="先输入当前店铺的普通兑换码并核对提交状态。只有确认上游未受理时才恢复提交资格。合作方兑换码请在 ID 系统复核。"
                    />
                </h2>
                <p className="text-sm leading-6 text-slate-500">
                    核对当前店铺未受理的普通兑换码。合作方兑换码请在 ID 系统复核。
                </p>
            </header>
            <form
                aria-labelledby={titleId}
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    void lookup();
                }}
            >
                <AdminField label="原兑换码" description="填写用户发起任务时使用的普通兑换码。">
                    <AdminInput
                        type="password"
                        name="rechargeSubmissionCode"
                        className="w-full border px-3 py-2 text-sm"
                        autoComplete="off"
                        maxLength={190}
                        required
                        disabled={busy}
                        value={code}
                        onChange={event => {
                            if (operation.current) return;
                            setCode(event.target.value);
                            setReview(undefined);
                            setFeedback(undefined);
                        }}
                    />
                </AdminField>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <AdminButton
                        type="submit"
                        className="recharge-settings-read px-3 py-2 text-sm font-medium"
                        disabled={busy || !code.trim()}
                        aria-busy={checking}
                    >
                        {checking ? '正在核对…' : '核对原兑换码'}
                    </AdminButton>
                    {review?.pending && review.code === code.trim() && (
                        <AdminButton
                            type="button"
                            className="recharge-settings-save px-3 py-2 text-sm font-medium"
                            disabled={busy}
                            aria-busy={recovery.loading}
                            onClick={() => void release()}
                        >
                            {recovery.loading ? '正在核对受理结果…' : '核对并解除锁定'}
                        </AdminButton>
                    )}
                </div>
            </form>
            {feedback && (
                <p
                    role={feedback.failed ? 'alert' : 'status'}
                    className="admin-page-status"
                    data-failed={feedback.failed || undefined}
                >
                    {feedback.message}
                </p>
            )}
        </section>
    );
}
