import { useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { getSystemLabel } from '../../../../common/src/display-localization';
import { systemFieldDisplayLabel } from '../../../../common/src/system-display-labels';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import {
    IMAGE_AI_USAGE_DETAIL_QUERY,
    IMAGE_AI_USAGE_RECORDS_QUERY,
    type ImageAiUsageRecord,
    type ImageAiUsageRecordDetailQueryResult,
    type ImageAiUsageRecordsQueryResult,
} from '../../graphql/image-usage.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';

const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-40';
const completenessLabels: Record<string, string> = {
    COMPLETE: '费用完整',
    PARTIAL: '部分已知',
    UNKNOWN: '费用待核对',
};
const outcomeLabels: Record<string, string> = {
    SUCCEEDED: '成功',
    FAILED: '失败',
    UNKNOWN: '结果待确认',
    QUEUED: '排队中',
    RUNNING: '处理中',
    PARTIAL_SUCCESS: '部分成功',
    CANCELLED: '已取消',
    MODEL: '模型优化',
    RULES: '规则降级',
};

export function ImageUsageCost({ record }: { record: ImageAiUsageRecord }) {
    return (
        <div className="space-y-1 text-xs">
            <div>{completenessLabels[record.costCompleteness] ?? '费用待核对'}</div>
            {record.costBreakdown.map(item => (
                <div key={item.currency} className="font-mono">
                    已知 {item.currency} {item.amount.toFixed(6)}
                </div>
            ))}
            {record.missingCostCount > 0 && (
                <div className="text-amber-700">{record.missingCostCount} 项费用缺失</div>
            )}
        </div>
    );
}

export function AiImageUsagePanel() {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setPage);
    const [recordType, setRecordType] = useState('');
    const [missingCostOnly, setMissingCostOnly] = useState(false);
    const [selected, setSelected] = useState<ImageAiUsageRecord | null>(null);
    const query = useQuery<ImageAiUsageRecordsQueryResult>(IMAGE_AI_USAGE_RECORDS_QUERY, {
        variables: {
            input: { skip: page * pageSize, take: pageSize, recordType: recordType || null, missingCostOnly },
        },
        // Both business tables expose numeric IDs under the same GraphQL type.
        // Fresh audit reads must not merge them in Apollo's id-based cache.
        fetchPolicy: 'no-cache',
        notifyOnNetworkStatusChange: true,
    });
    const records = query.data?.imageAiUsageRecords.items ?? [];
    const total = query.data?.imageAiUsageRecords.totalItems ?? 0;
    return (
        <section aria-label="使用记录与供应商费用" className="space-y-4">
            <p className="text-sm text-slate-600">
                客户收费与供应商成本分别记录。缺失费用保持待核对，不同币种分别显示。
            </p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
                <label>
                    记录类型{' '}
                    <select
                        aria-label="记录类型"
                        value={recordType}
                        className="rounded-lg border border-slate-300 bg-white p-2"
                        onChange={event => {
                            setRecordType(event.target.value);
                            setPage(0);
                        }}
                    >
                        <option value="">全部</option>
                        <option value="IMAGE_GENERATION">图片生成</option>
                        <option value="PROMPT_OPTIMIZATION">描述优化</option>
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={missingCostOnly}
                        onChange={event => {
                            setMissingCostOnly(event.target.checked);
                            setPage(0);
                        }}
                    />
                    仅看费用待核对
                </label>
                <button
                    type="button"
                    className={buttonClass}
                    disabled={query.loading}
                    onClick={() => void query.refetch()}
                >
                    刷新费用
                </button>
            </div>
            {query.loading ? (
                <p role="status">正在读取使用记录…</p>
            ) : query.error ? (
                <p role="alert" className="text-sm text-red-700">
                    {toUserFacingError(query.error, '使用记录读取失败，请重试')}
                </p>
            ) : !records.length ? (
                <p className="rounded-xl bg-white p-6 text-sm text-slate-500">当前条件下暂无使用记录</p>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full min-w-[780px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-500">
                            <tr>
                                {['记录 / 时间', '方案 / 状态', '客户收费', '供应商费用', '操作'].map(
                                    label => (
                                        <th key={label} scope="col" className="p-3">
                                            {label}
                                        </th>
                                    ),
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {records.map(record => (
                                <tr
                                    key={`${record.recordType}:${record.id}`}
                                    className="border-t border-slate-100 align-top"
                                >
                                    <td className="p-3">
                                        <div>
                                            {record.recordType === 'IMAGE_GENERATION' ? '生图' : '描述优化'} #
                                            {record.id}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                            {formatDateTime(record.createdAt)}
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <div>
                                            {record.recordType === 'PROMPT_OPTIMIZATION' ? '推荐方案：' : ''}
                                            {record.modelCode || '未记录'}
                                        </div>
                                        <div className="mt-1 text-xs">
                                            {getSystemLabel(record.state, outcomeLabels, 'zh', 'status')}
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <div>{formatMoney(record.chargedAmount, record.currencyCode)}</div>
                                        {record.refundedAmount > 0 && (
                                            <div className="text-xs">
                                                已退 {formatMoney(record.refundedAmount, record.currencyCode)}
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        <ImageUsageCost record={record} />
                                    </td>
                                    <td className="p-3">
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            onClick={() => setSelected(record)}
                                        >
                                            查看调用明细
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>共 {total} 条</span>
                <div className="flex items-center gap-2">
                    <PageSizeSelect
                        pageSize={pageSize}
                        onPageSizeChange={setPageSize}
                        disabled={query.loading}
                    />
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={query.loading || page === 0}
                        onClick={() => setPage(value => value - 1)}
                    >
                        上一页
                    </button>
                    <span>第 {page + 1} 页</span>
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={query.loading || (page + 1) * pageSize >= total}
                        onClick={() => setPage(value => value + 1)}
                    >
                        下一页
                    </button>
                </div>
            </div>
            {selected && (
                <ImageUsageDetail
                    key={`${selected.recordType}:${selected.id}`}
                    record={selected}
                    onClose={() => setSelected(null)}
                />
            )}
        </section>
    );
}

function ImageUsageDetail({ record, onClose }: { record: ImageAiUsageRecord; onClose: () => void }) {
    const query = useQuery<ImageAiUsageRecordDetailQueryResult>(IMAGE_AI_USAGE_DETAIL_QUERY, {
        variables: { recordType: record.recordType, id: record.id },
        // Both business tables expose numeric IDs under the same GraphQL type.
        // Fresh audit reads must not merge them in Apollo's id-based cache.
        fetchPolicy: 'no-cache',
    });
    const detail = query.data?.imageAiUsageRecord;
    return (
        <AccessibleDialogSurface
            accessibleName={`调用明细 #${record.id}`}
            onRequestClose={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 sm:p-6"
        >
            <section className="max-h-full w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl bg-white p-5">
                <header className="flex items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-bold">
                        调用明细 #{record.id}
                        <FeatureHelpButton topic="plugins.ai-usage" title="AI 图片调用明细" />
                    </h2>
                    <button type="button" className={buttonClass} onClick={onClose}>
                        关闭
                    </button>
                </header>
                {query.loading ? (
                    <p role="status">正在读取调用明细…</p>
                ) : query.error ? (
                    <div role="alert" className="space-y-3 text-sm text-red-700">
                        <p>{toUserFacingError(query.error, '调用明细读取失败')}</p>
                        <button type="button" className={buttonClass} onClick={() => void query.refetch()}>
                            重试读取
                        </button>
                    </div>
                ) : (
                    detail && (
                        <>
                            <ImageUsageCost record={detail.record} />
                            {(detail.costAdjustments ?? []).length > 0 && (
                                <section aria-label="历史费用审定" className="space-y-3">
                                    <h3 className="flex items-center gap-2 font-semibold">
                                        历史费用审定
                                        <FeatureHelpButton topic="plugins.ai-usage" title="历史费用审定" />
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        以下金额来自已审核的供应商账单交叉匹配，不代表请求编号直接匹配。更正记录按时间倒序保留。
                                    </p>
                                    {detail.costAdjustments.map(review => (
                                        <details
                                            key={review.id}
                                            className="rounded-lg border border-slate-200 p-3 text-sm"
                                        >
                                            <summary className="cursor-pointer">
                                                审定 #{review.id} ·{' '}
                                                {review.recordType === 'LEGACY_PROMPT'
                                                    ? '描述优化'
                                                    : review.recordType === 'PROMPT_ATTEMPT'
                                                      ? '描述优化调用'
                                                      : '生图费用'}{' '}
                                                #{review.recordIdSnapshot}
                                                {' · '}
                                                {review.newCostMicrounits == null || !review.newCurrency
                                                    ? '更正为费用未知'
                                                    : `${review.newCurrency} ${(review.newCostMicrounits / 1_000_000).toFixed(6)}`}
                                            </summary>
                                            <dl className="mt-3 grid gap-x-4 gap-y-2 break-all sm:grid-cols-[130px_1fr]">
                                                <dt>审核时间 / 人员</dt>
                                                <dd>
                                                    {formatDateTime(review.reviewedAt)} / {review.reviewer}
                                                </dd>
                                                <dt>关联方式</dt>
                                                <dd>
                                                    {review.matchingStatus === 'COST_REVERTED'
                                                        ? '费用已更正为未知'
                                                        : '交叉匹配已审'}
                                                </dd>
                                                <dt>批次 / 授权引用</dt>
                                                <dd>
                                                    {review.batchId} / {review.authorizationRef}
                                                </dd>
                                                <dt>原费用</dt>
                                                <dd>
                                                    {review.oldCostMicrounits == null || !review.oldCurrency
                                                        ? '未知'
                                                        : `${review.oldCurrency} ${(review.oldCostMicrounits / 1_000_000).toFixed(6)}`}
                                                </dd>
                                                <dt>审定说明</dt>
                                                <dd>{review.reason}</dd>
                                                {review.previousAdjustmentId && (
                                                    <>
                                                        <dt>更正前审定</dt>
                                                        <dd>#{review.previousAdjustmentId}</dd>
                                                    </>
                                                )}
                                                <dt>供应商账单</dt>
                                                <dd className="space-y-2">
                                                    {review.supplierBills.map(bill => (
                                                        <div key={`${bill.supplierScope}:${bill.billId}`}>
                                                            <div>
                                                                {bill.supplierScope} / {bill.billId}
                                                            </div>
                                                            <div>
                                                                {bill.currency}{' '}
                                                                {(bill.amountMicrounits / 1_000_000).toFixed(
                                                                    6,
                                                                )}{' '}
                                                                /{' '}
                                                                {bill.billedAt
                                                                    ? formatDateTime(bill.billedAt)
                                                                    : `${bill.displayedTime}（${bill.timeZone ?? '时区未核实'}）`}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </dd>
                                            </dl>
                                        </details>
                                    ))}
                                </section>
                            )}
                            <p className="text-xs text-slate-500">
                                请求编号用于追溯；保存编号不代表已经与供应商账单核实。
                            </p>
                            {!detail.attempts.length && (
                                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                                    暂无逐次调用明细；旧记录不能据此判断调用次数或零费用。
                                </p>
                            )}
                            {detail.attempts.map((attempt, index) => (
                                <details
                                    key={attempt.callId ?? `${attempt.attemptNumber}:${index}`}
                                    className="rounded-lg border border-slate-200 p-3 text-sm"
                                >
                                    <summary className="cursor-pointer">
                                        第 {attempt.attemptNumber} 次 · {attempt.modelId} ·{' '}
                                        {getSystemLabel(attempt.outcome, outcomeLabels, 'zh', 'status')}
                                        {' · '}
                                        {attempt.actualCostMicrounits == null || !attempt.costCurrency
                                            ? '费用待核对'
                                            : `${attempt.costCurrency} ${(attempt.actualCostMicrounits / 1_000_000).toFixed(6)}`}
                                    </summary>
                                    <dl className="mt-3 grid gap-x-4 gap-y-2 break-all sm:grid-cols-[130px_1fr]">
                                        <dt>时间 / 凭证</dt>
                                        <dd>
                                            {formatDateTime(attempt.createdAt)} /{' '}
                                            {attempt.credentialNameSnapshot || '未记录'}
                                        </dd>
                                        <dt>阶段 / 耗时</dt>
                                        <dd>
                                            {systemFieldDisplayLabel('stage', attempt.stage)} /{' '}
                                            {attempt.latencyMs} ms
                                            {attempt.httpStatus ? ` / HTTP ${attempt.httpStatus}` : ''}
                                        </dd>
                                        <dt>本地调用编号</dt>
                                        <dd>{attempt.callId ?? '历史未保存'}</dd>
                                        <dt>响应头编号</dt>
                                        <dd>
                                            {attempt.headerRequestId ?? '未返回'}{' '}
                                            {systemFieldDisplayLabel(
                                                'headerRequestIdSource',
                                                attempt.headerRequestIdSource,
                                            ) ?? ''}
                                        </dd>
                                        <dt>模型响应编号</dt>
                                        <dd>{attempt.modelResponseId ?? '未保存'}</dd>
                                        <dt>兼容请求编号</dt>
                                        <dd>{attempt.providerRequestId ?? '未保存'}</dd>
                                        <dt>账单关联</dt>
                                        <dd>
                                            {systemFieldDisplayLabel(
                                                'matchingStatus',
                                                attempt.matchingStatus,
                                            )}
                                        </dd>
                                        <dt>费用来源</dt>
                                        <dd>{systemFieldDisplayLabel('costSource', attempt.costSource)}</dd>
                                        {attempt.reportedCostEvidence && (
                                            <>
                                                <dt>响应申报金额</dt>
                                                <dd>
                                                    {attempt.reportedCostEvidence.amount}{' '}
                                                    {attempt.reportedCostEvidence.currency ?? '币种未提供'}{' '}
                                                    （待核实，字段：{attempt.reportedCostEvidence.field}）
                                                </dd>
                                            </>
                                        )}
                                    </dl>
                                </details>
                            ))}
                        </>
                    )
                )}
            </section>
        </AccessibleDialogSurface>
    );
}
