import type { ImageAiUsageRecordDetailQueryResult } from './image-generation.graphql';

type Detail = ImageAiUsageRecordDetailQueryResult['imageAiUsageRecord'];

export function ProviderAttemptDetails({ detail }: { detail: Detail }) {
    return (
        <section aria-label="供应商逐次调用" className="space-y-3">
            <div className="text-sm">
                供应商费用：{detail.record.costCompleteness === 'COMPLETE' ? '记录完整' : '待核对'}
                {detail.record.costBreakdown.map(item => (
                    <span key={item.currency}>
                        {' '}
                        · 已知 {item.amount.toFixed(6)} {item.currency}
                    </span>
                ))}
                {detail.record.missingCostCount > 0 ? ` · ${detail.record.missingCostCount} 次费用缺失` : ''}
            </div>
            {!detail.attempts.length ? (
                <p className="text-sm text-muted-foreground">
                    暂无逐次调用明细；旧记录不能据此判断调用次数或零费用。
                </p>
            ) : null}
            {detail.attempts.map(attempt => (
                <details
                    key={attempt.callId ?? `${attempt.modelId}:${attempt.attemptNumber}`}
                    className="rounded border p-3 text-sm"
                >
                    <summary className="cursor-pointer">
                        第 {attempt.attemptNumber} 次 · {attempt.modelId} ·{' '}
                        {attempt.outcome === 'SUCCEEDED'
                            ? '上游返回成功'
                            : attempt.outcome === 'FAILED'
                              ? '调用失败'
                              : '结果待核对'}
                        {' · '}
                        {attempt.actualCostMicrounits == null || !attempt.costCurrency
                            ? '费用待核对'
                            : `${(attempt.actualCostMicrounits / 1_000_000).toFixed(6)} ${attempt.costCurrency}`}
                    </summary>
                    <dl className="mt-3 grid gap-1 break-all">
                        <dt>模型凭证</dt>
                        <dd>{attempt.credentialNameSnapshot}</dd>
                        <dt>阶段 / 耗时</dt>
                        <dd>
                            {attempt.stage} / {attempt.latencyMs} ms
                            {attempt.httpStatus ? ` / HTTP ${attempt.httpStatus}` : ''}
                        </dd>
                        <dt>本地调用编号</dt>
                        <dd>{attempt.callId ?? '历史未保存'}</dd>
                        <dt>响应头编号</dt>
                        <dd>
                            {attempt.headerRequestId ?? '未返回'}{' '}
                            {attempt.headerRequestIdSource ? `(${attempt.headerRequestIdSource})` : ''}
                        </dd>
                        <dt>模型响应编号</dt>
                        <dd>{attempt.modelResponseId ?? '未保存'}</dd>
                        <dt>账单关联</dt>
                        <dd>尚未核实供应商账单；响应编号不等于已对账。</dd>
                        <dt>费用来源</dt>
                        <dd>{attempt.costSource === 'UNVERIFIED' ? '未核实' : attempt.costSource}</dd>
                        {attempt.reportedCostEvidence ? (
                            <>
                                <dt>响应申报金额（待核实）</dt>
                                <dd>
                                    {attempt.reportedCostEvidence.amount}{' '}
                                    {attempt.reportedCostEvidence.currency ?? '币种未提供'}
                                </dd>
                            </>
                        ) : null}
                    </dl>
                </details>
            ))}
        </section>
    );
}
