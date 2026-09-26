import { useMutation, useQuery } from '@apollo/client/react';
import { AlertTriangle, CheckCircle2, FileClock, Gavel, RefreshCw, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';
import {
    eventTypeDisplayLabel,
    severityDisplayLabel,
    systemStatusDisplayLabel,
} from '../../../../common/src/system-display-labels';

import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    GOVERNANCE_RISK_QUERY,
    GovernanceRiskResult,
    REVIEW_FRAUD_RISK_CASE_MUTATION,
    REVIEW_GOVERNANCE_APPROVAL_MUTATION,
    SUBMIT_GOVERNED_CONFIG_MUTATION,
} from '../../graphql/governance-risk.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';

const FRAUD_DEFAULT = JSON.stringify(
    {
        enabled: true,
        highValueThreshold: 100000,
        velocityOrderCount: 3,
        failedPaymentCount: 2,
        reviewScore: 40,
        holdScore: 60,
    },
    null,
    2,
);

export function GovernanceRiskPanel() {
    const query = useQuery<GovernanceRiskResult>(GOVERNANCE_RISK_QUERY, {
        variables: { riskOptions: { take: 100 }, auditTake: 50 },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [submitConfig, submitState] = useMutation(SUBMIT_GOVERNED_CONFIG_MUTATION);
    const [reviewApproval, approvalState] = useMutation<{
        reviewGovernanceApproval: { status: string };
    }>(REVIEW_GOVERNANCE_APPROVAL_MUTATION);
    const [reviewRisk, riskState] = useMutation(REVIEW_FRAUD_RISK_CASE_MUTATION);
    const [namespace, setNamespace] = useState<'FRAUD_RULES' | 'REPORT_SCHEDULE'>('FRAUD_RULES');
    const [payloadJson, setPayloadJson] = useState(FRAUD_DEFAULT);
    const [reason, setReason] = useState('调整风险复核阈值并保留双人审批证据');
    const [actionId, setActionId] = useState('');
    const [actionReason, setActionReason] = useState('');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const busy = submitState.loading || approvalState.loading || riskState.loading;
    const data = query.data;

    const run = async (work: () => Promise<unknown>, success: string) => {
        setError('');
        try {
            await work();
            setNotice(success);
            setActionId('');
            setActionReason('');
            await query.refetch();
        } catch (actionError) {
            setError(toUserFacingError(actionError, '治理操作失败'));
        }
    };
    const decideApproval = async (id: string, decision: 'APPROVE' | 'REJECT') => {
        const result = await reviewApproval({
            variables: {
                input: {
                    id,
                    decision,
                    reason: actionReason,
                    idempotencyKey: crypto.randomUUID(),
                },
            },
        });
        if (result.data?.reviewGovernanceApproval.status === 'EXPIRED') {
            throw new Error('治理审批已过期，请重新提交配置。');
        }
        return result;
    };

    return (
        <div className="space-y-4">
            <section className="grid gap-3 md:grid-cols-4">
                <Metric label="待审批配置" value={data?.governanceApprovals.length ?? 0} />
                <Metric label="风险案件" value={data?.fraudRiskCases.totalItems ?? 0} />
                <Metric label="审计记录" value={data?.governanceAuditEntries.totalItems ?? 0} />
                <Metric
                    label="审计链"
                    value={data?.governanceAuditIntegrity.valid ? '完整' : '异常'}
                    danger={data != null && !data.governanceAuditIntegrity.valid}
                />
            </section>

            {(notice || error) && (
                <div
                    className={`rounded-xl border p-3 text-xs ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
                >
                    {error || notice}
                </div>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            <Gavel className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                            受控配置与双人审批
                            <FeatureHelpButton topic="settings.governance-risk" title="治理与风险控制" />
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            提交人不能自审；批准后生成不可覆盖的新版本。
                        </p>
                    </div>
                    <button type="button" onClick={() => void query.refetch()} className={secondaryButton}>
                        <RefreshCw className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`} /> 刷新
                    </button>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[190px_1fr]">
                    <select
                        value={namespace}
                        onChange={event => {
                            const value = event.target.value as typeof namespace;
                            setNamespace(value);
                            setPayloadJson(
                                value === 'FRAUD_RULES'
                                    ? FRAUD_DEFAULT
                                    : JSON.stringify({ enabled: true, hourUtc: 0 }, null, 2),
                            );
                        }}
                        className={inputClass}
                    >
                        <option value="FRAUD_RULES">反欺诈规则</option>
                        <option value="REPORT_SCHEDULE">治理报告计划</option>
                    </select>
                    <input
                        value={reason}
                        onChange={event => setReason(event.target.value)}
                        className={inputClass}
                        placeholder="变更原因"
                    />
                    <textarea
                        value={payloadJson}
                        onChange={event => setPayloadJson(event.target.value)}
                        className="min-h-44 rounded-xl border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100 lg:col-span-2"
                        spellCheck={false}
                    />
                </div>
                <button
                    type="button"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                        void run(
                            () =>
                                submitConfig({
                                    variables: {
                                        input: {
                                            namespace,
                                            payloadJson,
                                            reason,
                                            idempotencyKey: crypto.randomUUID(),
                                        },
                                    },
                                }),
                            '配置审批已提交，须由另一位管理员审核。',
                        )
                    }
                    className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                    提交审批
                </button>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <FileClock className="h-4 w-4 text-amber-600" /> 待审批配置
                    <FeatureHelpButton topic="settings.governance-risk" title="待审批配置" />
                </h2>
                <div className="mt-3 space-y-3">
                    {data?.governanceApprovals.map(item => (
                        <article key={item.id} className="rounded-xl border border-slate-200 p-4 text-xs">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <p className="font-bold text-slate-900">
                                        {item.configVersion.namespace} · v{item.configVersion.version}
                                    </p>
                                    <p className="mt-1 text-slate-500">
                                        提交人 {item.requestedByUserId} · 到期{' '}
                                        {formatDateTime(item.expiresAt)}
                                    </p>
                                    <p className="mt-2 text-slate-700">{item.requestReason}</p>
                                </div>
                                <code className="text-[10px] text-slate-400">
                                    {item.configVersion.payloadHash.slice(0, 12)}
                                </code>
                            </div>
                            {actionId === `approval:${item.id}` ? (
                                <ActionEditor
                                    value={actionReason}
                                    onChange={setActionReason}
                                    disabled={busy}
                                    onCancel={() => setActionId('')}
                                    actions={[
                                        {
                                            label: '批准',
                                            tone: 'success',
                                            onClick: () =>
                                                void run(
                                                    () => decideApproval(item.id, 'APPROVE'),
                                                    '配置已批准并激活。',
                                                ),
                                        },
                                        {
                                            label: '拒绝',
                                            tone: 'danger',
                                            onClick: () =>
                                                void run(
                                                    () => decideApproval(item.id, 'REJECT'),
                                                    '配置已拒绝。',
                                                ),
                                        },
                                    ]}
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setActionId(`approval:${item.id}`)}
                                    className={`${secondaryButton} mt-3`}
                                >
                                    审核
                                </button>
                            )}
                        </article>
                    ))}
                    {!data?.governanceApprovals.length && <Empty text="没有待审批配置" />}
                </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <AlertTriangle className="h-4 w-4 text-rose-600" /> 风险复核与客户申诉
                    <FeatureHelpButton topic="settings.governance-risk" title="风险复核与客户申诉" />
                </h2>
                <div className="mt-3 space-y-3">
                    {data?.fraudRiskCases.items.map(item => (
                        <article key={item.id} className="rounded-xl border border-slate-200 p-4 text-xs">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <p className="font-bold text-slate-900">
                                        {item.caseCode} · {severityDisplayLabel(item.severity)} ·{' '}
                                        {systemStatusDisplayLabel(item.status)}
                                    </p>
                                    <p className="mt-1 text-slate-500">
                                        订单 {item.orderId ?? item.subjectId} · 评分 {item.riskScore} · 截止{' '}
                                        {formatDateTime(item.dueAt)}
                                    </p>
                                </div>
                                <span className="rounded-full bg-rose-50 px-2 py-1 font-semibold text-rose-700">
                                    {item.recommendedAction}
                                </span>
                            </div>
                            <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
                                {item.signalsJson}
                            </p>
                            {item.appeals
                                .filter(appeal => appeal.status === 'PENDING')
                                .map(appeal => (
                                    <div
                                        key={appeal.id}
                                        className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900"
                                    >
                                        客户申诉：{appeal.reason}
                                    </div>
                                ))}
                            {['OPEN', 'IN_REVIEW', 'APPEALED', 'REJECTED'].includes(item.status) &&
                                (actionId === `risk:${item.id}` ? (
                                    <ActionEditor
                                        value={actionReason}
                                        onChange={setActionReason}
                                        disabled={busy}
                                        onCancel={() => setActionId('')}
                                        actions={[
                                            {
                                                label: '认领',
                                                tone: 'neutral',
                                                onClick: () =>
                                                    void run(
                                                        () =>
                                                            reviewRisk({
                                                                variables: {
                                                                    input: {
                                                                        id: item.id,
                                                                        action: 'CLAIM',
                                                                        reason: actionReason,
                                                                        idempotencyKey: crypto.randomUUID(),
                                                                    },
                                                                },
                                                            }),
                                                        '风险案件已认领。',
                                                    ),
                                            },
                                            {
                                                label: '放行',
                                                tone: 'success',
                                                onClick: () =>
                                                    void run(
                                                        () =>
                                                            reviewRisk({
                                                                variables: {
                                                                    input: {
                                                                        id: item.id,
                                                                        action: 'RELEASE',
                                                                        reason: actionReason,
                                                                        idempotencyKey: crypto.randomUUID(),
                                                                    },
                                                                },
                                                            }),
                                                        '风险案件已放行，订单可以继续。',
                                                    ),
                                            },
                                            {
                                                label: '拦截',
                                                tone: 'danger',
                                                onClick: () =>
                                                    void run(
                                                        () =>
                                                            reviewRisk({
                                                                variables: {
                                                                    input: {
                                                                        id: item.id,
                                                                        action: 'BLOCK',
                                                                        reason: actionReason,
                                                                        idempotencyKey: crypto.randomUUID(),
                                                                    },
                                                                },
                                                            }),
                                                        '风险案件已拒绝。',
                                                    ),
                                            },
                                        ]}
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setActionId(`risk:${item.id}`)}
                                        className={`${secondaryButton} mt-3`}
                                    >
                                        复核案件
                                    </button>
                                ))}
                        </article>
                    ))}
                    {!data?.fraudRiskCases.items.length && <Empty text="没有风险案件" />}
                </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        {data?.governanceAuditIntegrity.valid ? (
                            <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        ) : (
                            <ShieldX className="h-4 w-4 text-rose-600" />
                        )}
                        不可变审计链
                        <FeatureHelpButton topic="settings.governance-risk" title="不可变审计链" />
                    </h2>
                    <div className="mt-3 space-y-2">
                        {data?.governanceAuditEntries.items.map(item => (
                            <div key={item.id} className="rounded-lg border border-slate-100 p-3 text-xs">
                                <p className="font-semibold text-slate-800">
                                    #{item.sequence} {eventTypeDisplayLabel(item.eventType)}
                                </p>
                                <p className="mt-1 text-slate-500">
                                    {item.resourceType} {item.resourceId} · {item.actorLabel}
                                </p>
                                <p className="mt-1 text-slate-700">{item.reason}</p>
                                <code className="mt-1 block text-[10px] text-slate-400">
                                    {item.entryHash.slice(0, 16)}
                                </code>
                            </div>
                        ))}
                        {!data?.governanceAuditEntries.items.length && <Empty text="尚无治理审计记录" />}
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <CheckCircle2 className="h-4 w-4 text-blue-600" /> 每日治理报告
                        <FeatureHelpButton topic="settings.governance-risk" title="每日治理报告" />
                    </h2>
                    <div className="mt-3 space-y-2">
                        {data?.governanceReports.map(report => (
                            <div key={report.id} className="rounded-lg border border-slate-100 p-3 text-xs">
                                <p className="font-semibold text-slate-800">
                                    {report.businessDate} · 异常 {report.anomalyCount}
                                </p>
                                <p className="mt-1 break-all text-slate-500">{report.metricsJson}</p>
                                <code className="mt-1 block text-[10px] text-slate-400">
                                    {report.digest.slice(0, 16)}
                                </code>
                            </div>
                        ))}
                        {!data?.governanceReports.length && <Empty text="定时任务运行后会生成每日治理报告" />}
                    </div>
                </div>
            </section>
        </div>
    );
}

function Metric({
    label,
    value,
    danger = false,
}: {
    label: string;
    value: string | number;
    danger?: boolean;
}) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-black ${danger ? 'text-rose-600' : 'text-slate-900'}`}>
                {value}
            </p>
        </div>
    );
}

function Empty({ text }: { text: string }) {
    return <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">{text}</p>;
}

function ActionEditor({
    value,
    onChange,
    onCancel,
    disabled,
    actions,
}: {
    value: string;
    onChange: (value: string) => void;
    onCancel: () => void;
    disabled: boolean;
    actions: Array<{ label: string; tone: 'neutral' | 'success' | 'danger'; onClick: () => void }>;
}) {
    return (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <input
                value={value}
                onChange={event => onChange(event.target.value)}
                className={inputClass}
                placeholder="填写审核依据或决定原因"
            />
            <div className="mt-2 flex flex-wrap gap-2">
                {actions.map(action => (
                    <button
                        key={action.label}
                        type="button"
                        disabled={disabled || !value.trim()}
                        onClick={action.onClick}
                        className={`rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50 ${action.tone === 'danger' ? 'bg-rose-600' : action.tone === 'success' ? 'bg-emerald-600' : 'bg-slate-700'}`}
                    >
                        {action.label}
                    </button>
                ))}
                <button type="button" disabled={disabled} onClick={onCancel} className={secondaryButton}>
                    取消
                </button>
            </div>
        </div>
    );
}

const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500';
const secondaryButton =
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
