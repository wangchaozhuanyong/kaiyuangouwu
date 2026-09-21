import { useMutation, useQuery } from '@apollo/client/react';
import { Store } from 'lucide-react';
import { useState } from 'react';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    PLATFORM_GOVERNANCE_REVIEW_QUERY,
    REVIEW_STORE_GOVERNANCE_CHANGE_MUTATION,
    type PlatformGovernanceReviewResult,
} from '../../graphql/management.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { ErrorState, Message, SettingsContentSkeleton, primaryButton, secondaryButton } from './settings-ui';
import { governancePayloadRows, governanceRequestTypeLabel } from './StoreGovernanceLabels';
export function PlatformGovernanceReviewCenter() {
    const requestConfirmation = useConfirmDialog();
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<PlatformGovernanceReviewResult>(PLATFORM_GOVERNANCE_REVIEW_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const [reviewGovernance, reviewState] = useMutation(REVIEW_STORE_GOVERNANCE_CHANGE_MUTATION);
    const reviewRequest = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
        const reason = decision === 'REJECTED' ? window.prompt('请输入驳回原因')?.trim() : '';
        if (decision === 'REJECTED' && !reason) return;
        const confirmation = await requestConfirmation({
            title: decision === 'APPROVED' ? '确认通过治理申请' : '确认驳回治理申请',
            description: '该操作会记录审核人和脱敏审计摘要，请验证当前账号密码。',
            confirmLabel: decision === 'APPROVED' ? '验证并通过' : '验证并驳回',
            tone: decision === 'APPROVED' ? 'default' : 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            await reviewGovernance({
                variables: {
                    input: {
                        id,
                        decision,
                        reason: reason || null,
                        currentPassword: confirmation.currentPassword ?? '',
                    },
                },
            });
            setNotice(decision === 'APPROVED' ? '申请已通过，批准记录已更新' : '申请已驳回');
            setActionError('');
            await query.refetch();
        } catch (error) {
            setActionError(toUserFacingError(error, '审核店铺治理变更失败'));
        }
    };
    if (query.error && !query.data) {
        return (
            <ErrorState
                message={toUserFacingError(query.error, '治理审批队列读取失败')}
                onRetry={() => void query.refetch()}
            />
        );
    }
    if (!query.data) return <SettingsContentSkeleton label="正在读取治理审批队列" sections={2} />;
    const pending = query.data.storeGovernanceChanges.filter(request => request.status === 'PENDING');
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                    <Store className="h-5 w-5 text-blue-600" />
                    店铺治理审批
                    <FeatureHelpButton topic="settings.store-profile" title="店铺治理审批" />
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                    此岗位只能审核店铺提交的主体与支付治理申请，不会读取平台密钥或其他设置。
                </p>
            </header>
            <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        待审批申请
                        <FeatureHelpButton topic="settings.store-profile" title="待审批申请" />
                    </h2>
                    {pending.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-500">当前没有待审批申请。</p>
                    ) : (
                        <div className="mt-3 space-y-2">
                            {pending.map(request => (
                                <div
                                    key={request.id}
                                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="text-xs">
                                        <div className="font-bold text-slate-800">
                                            {getChannelDisplayName(request.channel)} ·{' '}
                                            {governanceRequestTypeLabel(request.requestType)}
                                        </div>
                                        <div className="mt-1 space-y-0.5 text-slate-500">
                                            <div>版本 {request.version}</div>
                                            {governancePayloadRows(
                                                request.reviewPayload ?? request.maskedSummary,
                                            ).map(([label, value]) => (
                                                <div key={label}>
                                                    {label}：{value}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={reviewState.loading}
                                            onClick={() => void reviewRequest(request.id, 'REJECTED')}
                                            className={secondaryButton}
                                        >
                                            驳回
                                        </button>
                                        <button
                                            type="button"
                                            disabled={reviewState.loading}
                                            onClick={() => void reviewRequest(request.id, 'APPROVED')}
                                            className={primaryButton}
                                        >
                                            通过
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
