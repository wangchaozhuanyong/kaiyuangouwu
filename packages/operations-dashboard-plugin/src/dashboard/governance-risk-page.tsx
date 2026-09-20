import { msg } from '@lingui/core/macro';
import {
    Badge,
    Button,
    DashboardRouteDefinition,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Skeleton,
    Textarea,
    api,
    toast,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';

import {
    GovernanceRiskResult,
    governanceRiskQuery,
    reviewFraudRiskCaseMutation,
    reviewGovernanceApprovalMutation,
    submitGovernedConfigMutation,
} from './governance-risk.graphql';

const title = msg({ id: 'operations.governanceRisk.title', message: 'Governance & risk control' });
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

export const governanceRiskRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'governance-risk',
        url: '/governance-risk',
        title: title.id,
        icon: ShieldCheck,
        requiresPermission: ['SuperAdmin'],
    },
    path: '/governance-risk',
    loader: () => ({ breadcrumb: () => title.id }),
    component: () => <GovernanceRiskPage />,
};

function GovernanceRiskPage() {
    const [namespace, setNamespace] = useState<'FRAUD_RULES' | 'REPORT_SCHEDULE'>('FRAUD_RULES');
    const [payloadJson, setPayloadJson] = useState(FRAUD_DEFAULT);
    const [reason, setReason] = useState('调整治理配置并保留双人审批证据');
    const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
    const query = useQuery({
        queryKey: ['operations-governance-risk'],
        queryFn: () => api.query<GovernanceRiskResult>(governanceRiskQuery),
        refetchInterval: 15_000,
    });
    const submit = useMutation({
        mutationFn: () =>
            api.mutate(submitGovernedConfigMutation, {
                input: { namespace, payloadJson, reason, idempotencyKey: crypto.randomUUID() },
            }),
        onSuccess: () => refreshed('配置已提交，需由另一位管理员审批。'),
        onError: error => toast.error(errorMessage(error)),
    });
    const reviewApproval = useMutation({
        mutationFn: async (input: { id: string; decision: 'APPROVE' | 'REJECT'; reason: string }) => {
            const result = await api.mutate<{
                reviewGovernanceApproval: { status: string };
            }>(reviewGovernanceApprovalMutation, {
                input: { ...input, idempotencyKey: crypto.randomUUID() },
            });
            if (result.reviewGovernanceApproval.status === 'EXPIRED') {
                throw new Error('治理审批已过期，请重新提交配置。');
            }
            return result;
        },
        onSuccess: () => refreshed('治理审批已更新。'),
        onError: error => toast.error(errorMessage(error)),
    });
    const reviewRisk = useMutation({
        mutationFn: (input: { id: string; action: 'CLAIM' | 'RELEASE' | 'BLOCK'; reason: string }) =>
            api.mutate(reviewFraudRiskCaseMutation, {
                input: { ...input, idempotencyKey: crypto.randomUUID() },
            }),
        onSuccess: () => refreshed('风险案件已更新。'),
        onError: error => toast.error(errorMessage(error)),
    });
    const data = query.data;
    const busy = submit.isPending || reviewApproval.isPending || reviewRisk.isPending;

    async function refreshed(message: string) {
        toast.success(message);
        setReviewReasons({});
        await query.refetch();
    }

    const reasonFor = (key: string) => reviewReasons[key] ?? '';
    const setReasonFor = (key: string, value: string) =>
        setReviewReasons(current => ({ ...current, [key]: value }));

    return (
        <Page pageId="governance-risk">
            <PageTitle>{title.id}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        variant="outline"
                        onClick={() => void query.refetch()}
                        disabled={query.isFetching}
                    >
                        <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
                        刷新
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="governance-summary">
                    <div className="mb-5 grid gap-3 md:grid-cols-4">
                        <Metric label="待审批配置" value={data?.governanceApprovals.length ?? 0} />
                        <Metric label="风险案件" value={data?.fraudRiskCases.totalItems ?? 0} />
                        <Metric label="审计记录" value={data?.governanceAuditEntries.totalItems ?? 0} />
                        <Metric
                            label="审计链"
                            value={data?.governanceAuditIntegrity.valid ? '完整' : '异常'}
                            danger={data != null && !data.governanceAuditIntegrity.valid}
                        />
                    </div>
                    <div className="rounded-lg border p-4">
                        <h2 className="font-semibold">受控配置与双人审批</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            提交人不能自审；批准后旧版本自动退役，所有决定进入链式审计。
                        </p>
                        <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr]">
                            <select
                                className={inputClass}
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
                            >
                                <option value="FRAUD_RULES">风险规则</option>
                                <option value="REPORT_SCHEDULE">报告计划</option>
                            </select>
                            <input
                                className={inputClass}
                                value={reason}
                                onChange={event => setReason(event.target.value)}
                                placeholder="变更原因"
                            />
                        </div>
                        <Textarea
                            className="mt-3 min-h-44 font-mono text-xs"
                            value={payloadJson}
                            onChange={event => setPayloadJson(event.target.value)}
                        />
                        <Button
                            className="mt-3"
                            disabled={busy || !reason.trim() || !payloadJson.trim()}
                            onClick={() => void submit.mutate()}
                        >
                            提交审批
                        </Button>
                    </div>
                </PageBlock>

                <PageBlock column="main" blockId="governance-approvals">
                    <h2 className="mb-3 font-semibold">待审批配置</h2>
                    <div className="space-y-3">
                        {(data?.governanceApprovals ?? []).map(item => {
                            const key = `approval:${item.id}`;
                            return (
                                <article key={item.id} className="rounded-lg border p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge>{item.configVersion.namespace}</Badge>
                                        <strong>v{item.configVersion.version}</strong>
                                        <span className="text-xs text-muted-foreground">
                                            提交人 {item.requestedByUserId} · 到期{' '}
                                            {formatDate(item.expiresAt)}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm">{item.requestReason}</p>
                                    <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs">
                                        {item.configVersion.payloadJson}
                                    </pre>
                                    <DecisionEditor
                                        value={reasonFor(key)}
                                        disabled={busy}
                                        onChange={value => setReasonFor(key, value)}
                                        actions={[
                                            {
                                                label: '批准',
                                                onClick: () =>
                                                    reviewApproval.mutate({
                                                        id: item.id,
                                                        decision: 'APPROVE',
                                                        reason: reasonFor(key),
                                                    }),
                                            },
                                            {
                                                label: '驳回',
                                                destructive: true,
                                                onClick: () =>
                                                    reviewApproval.mutate({
                                                        id: item.id,
                                                        decision: 'REJECT',
                                                        reason: reasonFor(key),
                                                    }),
                                            },
                                        ]}
                                    />
                                </article>
                            );
                        })}
                        {!data?.governanceApprovals.length && <Empty text="没有待审批配置" />}
                    </div>
                </PageBlock>

                <PageBlock column="main" blockId="fraud-risk-cases">
                    <h2 className="mb-3 flex items-center gap-2 font-semibold">
                        <ShieldAlert className="h-4 w-4" /> 风险案件与客户申诉
                    </h2>
                    {query.isLoading ? (
                        <Skeleton className="h-40 w-full" />
                    ) : (
                        <div className="space-y-3">
                            {(data?.fraudRiskCases.items ?? []).map(item => {
                                const key = `risk:${item.id}`;
                                return (
                                    <article key={item.id} className="rounded-lg border p-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge
                                                variant={item.severity === 'P1' ? 'destructive' : 'secondary'}
                                            >
                                                {item.severity}
                                            </Badge>
                                            <strong>{item.caseCode}</strong>
                                            <Badge variant="outline">{item.status}</Badge>
                                            <span className="text-xs text-muted-foreground">
                                                评分 {item.riskScore} · 订单 {item.orderId ?? '—'} · 截止{' '}
                                                {formatDate(item.dueAt)}
                                            </span>
                                        </div>
                                        <p className="mt-2 break-all text-xs text-muted-foreground">
                                            {item.signalsJson}
                                        </p>
                                        {item.appeals
                                            .filter(appeal => appeal.status === 'PENDING')
                                            .map(appeal => (
                                                <p
                                                    key={appeal.id}
                                                    className="mt-2 rounded bg-amber-50 p-2 text-xs"
                                                >
                                                    客户申诉：{appeal.reason}
                                                </p>
                                            ))}
                                        <DecisionEditor
                                            value={reasonFor(key)}
                                            disabled={busy}
                                            onChange={value => setReasonFor(key, value)}
                                            actions={[
                                                {
                                                    label: '认领',
                                                    onClick: () =>
                                                        reviewRisk.mutate({
                                                            id: item.id,
                                                            action: 'CLAIM',
                                                            reason: reasonFor(key),
                                                        }),
                                                },
                                                {
                                                    label: '放行',
                                                    onClick: () =>
                                                        reviewRisk.mutate({
                                                            id: item.id,
                                                            action: 'RELEASE',
                                                            reason: reasonFor(key),
                                                        }),
                                                },
                                                {
                                                    label: '拦截',
                                                    destructive: true,
                                                    onClick: () =>
                                                        reviewRisk.mutate({
                                                            id: item.id,
                                                            action: 'BLOCK',
                                                            reason: reasonFor(key),
                                                        }),
                                                },
                                            ]}
                                        />
                                    </article>
                                );
                            })}
                            {!data?.fraudRiskCases.items.length && <Empty text="没有风险案件" />}
                        </div>
                    )}
                </PageBlock>

                <PageBlock column="main" blockId="governance-evidence">
                    <div className="grid gap-4 xl:grid-cols-2">
                        <section>
                            <h2 className="mb-3 flex items-center gap-2 font-semibold">
                                {data?.governanceAuditIntegrity.valid ? (
                                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                ) : (
                                    <ShieldX className="h-4 w-4 text-destructive" />
                                )}
                                不可变审计链
                            </h2>
                            <div className="space-y-2">
                                {(data?.governanceAuditEntries.items ?? []).map(item => (
                                    <div key={item.id} className="rounded border p-3 text-xs">
                                        <strong>
                                            #{item.sequence} {item.eventType}
                                        </strong>
                                        <p className="mt-1 text-muted-foreground">
                                            {item.resourceType} {item.resourceId} · {item.actorLabel}
                                        </p>
                                        <p className="mt-1">{item.reason}</p>
                                        <code className="mt-1 block text-muted-foreground">
                                            {item.entryHash.slice(0, 16)}
                                        </code>
                                    </div>
                                ))}
                            </div>
                        </section>
                        <section>
                            <h2 className="mb-3 flex items-center gap-2 font-semibold">
                                <CheckCircle2 className="h-4 w-4 text-blue-600" /> 每日治理报告
                            </h2>
                            <div className="space-y-2">
                                {(data?.governanceReports ?? []).map(report => (
                                    <div key={report.id} className="rounded border p-3 text-xs">
                                        <strong>
                                            {report.businessDate} · 异常 {report.anomalyCount}
                                        </strong>
                                        <p className="mt-1 break-all text-muted-foreground">
                                            {report.metricsJson}
                                        </p>
                                    </div>
                                ))}
                                {!data?.governanceReports.length && (
                                    <Empty text="定时任务运行后会生成每日治理报告" />
                                )}
                            </div>
                        </section>
                    </div>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function DecisionEditor({
    value,
    onChange,
    disabled,
    actions,
}: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
    actions: Array<{ label: string; destructive?: boolean; onClick: () => void }>;
}) {
    return (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
                className={inputClass}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder="填写审核依据或决定原因"
            />
            {actions.map(action => (
                <Button
                    key={action.label}
                    variant={action.destructive ? 'destructive' : 'default'}
                    disabled={disabled || !value.trim()}
                    onClick={action.onClick}
                >
                    {action.label}
                </Button>
            ))}
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
        <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={danger ? 'mt-1 text-2xl font-bold text-destructive' : 'mt-1 text-2xl font-bold'}>
                {value}
            </p>
        </div>
    );
}

function Empty({ text }: { text: string }) {
    return <p className="rounded bg-muted p-3 text-sm text-muted-foreground">{text}</p>;
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '治理操作失败';
}

const inputClass =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';
