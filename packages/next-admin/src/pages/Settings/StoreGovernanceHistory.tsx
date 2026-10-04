import type { StoreManagementResult } from '../../graphql/management.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { governancePayloadRows, governanceRequestTypeLabel } from './StoreGovernanceLabels';

/** Approved values are separate from pending applications; only masked summaries are displayed. */
export function StoreGovernanceHistory({
    records,
}: {
    records: StoreManagementResult['storeGovernanceChanges'];
}) {
    const reviewed = records.filter(item => item.status !== 'PENDING');
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">已审核记录</h2>
            {reviewed.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">暂无已审核记录。</p>
            ) : (
                <div className="mt-3 space-y-2">
                    {reviewed.map(item => (
                        <article key={item.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                            <p className="font-bold">
                                {getChannelDisplayName(item.channel)} ·{' '}
                                {governanceRequestTypeLabel(item.requestType)} · 版本 {item.version} ·{' '}
                                {item.status === 'APPROVED' ? '已批准' : '已驳回'}
                            </p>
                            <div className="mt-1 space-y-1 text-slate-500">
                                {governancePayloadRows(item.maskedSummary).map(([label, value]) => (
                                    <p key={label}>
                                        {label}：{value}
                                    </p>
                                ))}
                                {item.reviewReason && <p>审核意见：{item.reviewReason}</p>}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
