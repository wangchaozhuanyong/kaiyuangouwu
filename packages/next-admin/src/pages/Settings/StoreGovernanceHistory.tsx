import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { governancePayloadRows, governanceRequestTypeLabel } from './StoreGovernanceLabels';

/** Approved values are separate from pending applications; only masked summaries are displayed. */
export function StoreGovernanceHistory({
    records,
    payloadType,
}: {
    records: StoreManagementResult['storeGovernanceChanges'];
    payloadType?: 'payout' | 'legal';
}) {
    const reviewed = records.filter(item => item.status !== 'PENDING');
    const payloadColumns = [
        ...new Set([
            ...(payloadType === 'payout'
                ? ['provider', 'accountHolder', 'accountIdentifier']
                : payloadType === 'legal'
                  ? ['legalEntityName', 'legalRegistrationCountry']
                  : []),
            ...reviewed.flatMap(item => Object.keys(item.maskedSummary)),
        ]),
    ].map(key => ({ key, label: governancePayloadRows({ [key]: null })[0][0] }));
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="admin-section-title-line">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    已审核记录
                    <FeatureHelpButton
                        topic="settings.store-profile"
                        title="已审核记录"
                        description="查看已批准或已驳回的店铺治理申请及审核意见，敏感资料仅显示脱敏摘要。"
                    />
                </h2>
                <p className="text-xs text-slate-500">批准值与待审申请独立展示</p>
            </div>
            <div
                className="admin-comparison-scroll mt-3 overflow-x-auto"
                role="region"
                aria-label="已审核店铺治理记录"
                tabIndex={0}
            >
                <p className="admin-mobile-table-hint">左右滑动查看完整审核记录</p>
                <table className="admin-compact-table w-full min-w-[1060px] text-left text-xs">
                    <thead>
                        <tr>
                            {['店铺', '类型', '版本', '状态'].map(label => (
                                <th key={label}>{label}</th>
                            ))}
                            {payloadColumns.map(column => (
                                <th key={column.key}>{column.label}</th>
                            ))}
                            {<th>审核意见</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {reviewed.map(item => {
                            return (
                                <tr key={item.id}>
                                    <td className="font-semibold">{getChannelDisplayName(item.channel)}</td>
                                    <td>{governanceRequestTypeLabel(item.requestType)}</td>
                                    <td>{item.version}</td>
                                    <td>{item.status === 'APPROVED' ? '已批准' : '已驳回'}</td>
                                    {payloadColumns.map(column => {
                                        const value = governancePayloadRows({
                                            [column.key]: item.maskedSummary[column.key],
                                        })[0][1];
                                        return (
                                            <td key={column.key} className="max-w-72 truncate" title={value}>
                                                {value}
                                            </td>
                                        );
                                    })}
                                    <td className="max-w-72 truncate" title={item.reviewReason ?? ''}>
                                        {item.reviewReason || '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {!reviewed.length && <p className="mt-3 text-xs text-slate-500">暂无已审核记录。</p>}
        </section>
    );
}
