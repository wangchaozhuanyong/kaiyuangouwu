import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
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
    eventTypeDisplayLabel,
    severityDisplayLabel,
    systemStatusDisplayLabel,
} from '../../../common/src/system-display-labels';

import {
    GovernanceRiskResult,
    governanceRiskQuery,
    reviewFraudRiskCaseMutation,
    reviewGovernanceApprovalMutation,
    submitGovernedConfigMutation,
} from './governance-risk.graphql';

const title = msg({ id: 'operations.governanceRisk.title', message: 'Governance & risk control' });
const messages = {
    defaultReason: msg({
        id: 'operations.governanceRisk.defaultReason',
        message: 'Adjust governance configuration with two-person approval evidence',
    }),
    submitted: msg({
        id: 'operations.governanceRisk.submitted',
        message: 'Configuration submitted. Another administrator must approve it.',
    }),
    expired: msg({
        id: 'operations.governanceRisk.expired',
        message: 'Governance approval expired. Submit the configuration again.',
    }),
    approvalUpdated: msg({
        id: 'operations.governanceRisk.approvalUpdated',
        message: 'Governance approval updated.',
    }),
    riskUpdated: msg({ id: 'operations.governanceRisk.riskUpdated', message: 'Risk case updated.' }),
    refresh: msg({ id: 'operations.governanceRisk.refresh', message: 'Refresh' }),
    pendingApprovals: msg({
        id: 'operations.governanceRisk.pendingApprovals',
        message: 'Pending configurations',
    }),
    riskCases: msg({ id: 'operations.governanceRisk.riskCases', message: 'Risk cases' }),
    auditEntries: msg({ id: 'operations.governanceRisk.auditEntries', message: 'Audit entries' }),
    auditChain: msg({ id: 'operations.governanceRisk.auditChain', message: 'Audit chain' }),
    valid: msg({ id: 'operations.governanceRisk.valid', message: 'Valid' }),
    invalid: msg({ id: 'operations.governanceRisk.invalid', message: 'Invalid' }),
    controlledConfig: msg({
        id: 'operations.governanceRisk.controlledConfig',
        message: 'Controlled configuration and two-person approval',
    }),
    configDescription: msg({
        id: 'operations.governanceRisk.configDescription',
        message:
            'Submitters cannot approve their own changes. Approval retires the old version, and all decisions enter the chained audit log.',
    }),
    fraudRules: msg({ id: 'operations.governanceRisk.fraudRules', message: 'Fraud rules' }),
    reportSchedule: msg({ id: 'operations.governanceRisk.reportSchedule', message: 'Report schedule' }),
    changeReason: msg({ id: 'operations.governanceRisk.changeReason', message: 'Reason for change' }),
    submit: msg({ id: 'operations.governanceRisk.submit', message: 'Submit for approval' }),
    submittedBy: msg({ id: 'operations.governanceRisk.submittedBy', message: 'Submitted by' }),
    expires: msg({ id: 'operations.governanceRisk.expires', message: 'Expires' }),
    approve: msg({ id: 'operations.governanceRisk.approve', message: 'Approve' }),
    reject: msg({ id: 'operations.governanceRisk.reject', message: 'Reject' }),
    noApprovals: msg({ id: 'operations.governanceRisk.noApprovals', message: 'No pending configurations' }),
    riskAndAppeals: msg({
        id: 'operations.governanceRisk.riskAndAppeals',
        message: 'Risk cases and customer appeals',
    }),
    score: msg({ id: 'operations.governanceRisk.score', message: 'Score' }),
    order: msg({ id: 'operations.governanceRisk.order', message: 'Order' }),
    due: msg({ id: 'operations.governanceRisk.due', message: 'Due' }),
    customerAppeal: msg({ id: 'operations.governanceRisk.customerAppeal', message: 'Customer appeal:' }),
    claim: msg({ id: 'operations.governanceRisk.claim', message: 'Claim' }),
    release: msg({ id: 'operations.governanceRisk.release', message: 'Release' }),
    block: msg({ id: 'operations.governanceRisk.block', message: 'Block' }),
    noRiskCases: msg({ id: 'operations.governanceRisk.noRiskCases', message: 'No risk cases' }),
    immutableAudit: msg({ id: 'operations.governanceRisk.immutableAudit', message: 'Immutable audit chain' }),
    dailyReports: msg({ id: 'operations.governanceRisk.dailyReports', message: 'Daily governance reports' }),
    anomalies: msg({ id: 'operations.governanceRisk.anomalies', message: 'Anomalies' }),
    reportsPending: msg({
        id: 'operations.governanceRisk.reportsPending',
        message: 'Daily governance reports appear after the scheduled job runs',
    }),
    decisionReason: msg({
        id: 'operations.governanceRisk.decisionReason',
        message: 'Enter review evidence or decision reason',
    }),
    operationFailed: msg({
        id: 'operations.governanceRisk.operationFailed',
        message: 'Governance action failed',
    }),
};
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
    const { t } = useLingui();
    const [namespace, setNamespace] = useState<'FRAUD_RULES' | 'REPORT_SCHEDULE'>('FRAUD_RULES');
    const [payloadJson, setPayloadJson] = useState(FRAUD_DEFAULT);
    const [reason, setReason] = useState(() => t(messages.defaultReason));
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
        onSuccess: () => refreshed(t(messages.submitted)),
        onError: error => toast.error(errorMessage(error, t(messages.operationFailed))),
    });
    const reviewApproval = useMutation({
        mutationFn: async (input: { id: string; decision: 'APPROVE' | 'REJECT'; reason: string }) => {
            const result = await api.mutate<{
                reviewGovernanceApproval: { status: string };
            }>(reviewGovernanceApprovalMutation, {
                input: { ...input, idempotencyKey: crypto.randomUUID() },
            });
            if (result.reviewGovernanceApproval.status === 'EXPIRED') {
                throw new Error(t(messages.expired));
            }
            return result;
        },
        onSuccess: () => refreshed(t(messages.approvalUpdated)),
        onError: error => toast.error(errorMessage(error, t(messages.operationFailed))),
    });
    const reviewRisk = useMutation({
        mutationFn: (input: { id: string; action: 'CLAIM' | 'RELEASE' | 'BLOCK'; reason: string }) =>
            api.mutate(reviewFraudRiskCaseMutation, {
                input: { ...input, idempotencyKey: crypto.randomUUID() },
            }),
        onSuccess: () => refreshed(t(messages.riskUpdated)),
        onError: error => toast.error(errorMessage(error, t(messages.operationFailed))),
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
                        {t(messages.refresh)}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="governance-summary">
                    <div className="mb-5 grid gap-3 md:grid-cols-4">
                        <Metric
                            label={t(messages.pendingApprovals)}
                            value={data?.governanceApprovals.length ?? 0}
                        />
                        <Metric label={t(messages.riskCases)} value={data?.fraudRiskCases.totalItems ?? 0} />
                        <Metric
                            label={t(messages.auditEntries)}
                            value={data?.governanceAuditEntries.totalItems ?? 0}
                        />
                        <Metric
                            label={t(messages.auditChain)}
                            value={
                                data?.governanceAuditIntegrity.valid ? t(messages.valid) : t(messages.invalid)
                            }
                            danger={data != null && !data.governanceAuditIntegrity.valid}
                        />
                    </div>
                    <div className="rounded-lg border p-4">
                        <h2 className="font-semibold">{t(messages.controlledConfig)}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{t(messages.configDescription)}</p>
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
                                <option value="FRAUD_RULES">{t(messages.fraudRules)}</option>
                                <option value="REPORT_SCHEDULE">{t(messages.reportSchedule)}</option>
                            </select>
                            <input
                                className={inputClass}
                                value={reason}
                                onChange={event => setReason(event.target.value)}
                                placeholder={t(messages.changeReason)}
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
                            {t(messages.submit)}
                        </Button>
                    </div>
                </PageBlock>

                <PageBlock column="main" blockId="governance-approvals">
                    <h2 className="mb-3 font-semibold">{t(messages.pendingApprovals)}</h2>
                    <div className="space-y-3">
                        {(data?.governanceApprovals ?? []).map(item => {
                            const key = `approval:${item.id}`;
                            return (
                                <article key={item.id} className="rounded-lg border p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge>{item.configVersion.namespace}</Badge>
                                        <strong>v{item.configVersion.version}</strong>
                                        <span className="text-xs text-muted-foreground">
                                            {t(messages.submittedBy)} {item.requestedByUserId} ·{' '}
                                            {t(messages.expires)} {formatDate(item.expiresAt)}
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
                                                label: t(messages.approve),
                                                onClick: () =>
                                                    reviewApproval.mutate({
                                                        id: item.id,
                                                        decision: 'APPROVE',
                                                        reason: reasonFor(key),
                                                    }),
                                            },
                                            {
                                                label: t(messages.reject),
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
                        {!data?.governanceApprovals.length && <Empty text={t(messages.noApprovals)} />}
                    </div>
                </PageBlock>

                <PageBlock column="main" blockId="fraud-risk-cases">
                    <h2 className="mb-3 flex items-center gap-2 font-semibold">
                        <ShieldAlert className="h-4 w-4" /> {t(messages.riskAndAppeals)}
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
                                                {severityDisplayLabel(item.severity)}
                                            </Badge>
                                            <strong>{item.caseCode}</strong>
                                            <Badge variant="outline">
                                                {systemStatusDisplayLabel(item.status)}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {t(messages.score)} {item.riskScore} · {t(messages.order)}{' '}
                                                {item.orderId ?? '—'} · {t(messages.due)}{' '}
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
                                                    {t(messages.customerAppeal)} {appeal.reason}
                                                </p>
                                            ))}
                                        <DecisionEditor
                                            value={reasonFor(key)}
                                            disabled={busy}
                                            onChange={value => setReasonFor(key, value)}
                                            actions={[
                                                {
                                                    label: t(messages.claim),
                                                    onClick: () =>
                                                        reviewRisk.mutate({
                                                            id: item.id,
                                                            action: 'CLAIM',
                                                            reason: reasonFor(key),
                                                        }),
                                                },
                                                {
                                                    label: t(messages.release),
                                                    onClick: () =>
                                                        reviewRisk.mutate({
                                                            id: item.id,
                                                            action: 'RELEASE',
                                                            reason: reasonFor(key),
                                                        }),
                                                },
                                                {
                                                    label: t(messages.block),
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
                            {!data?.fraudRiskCases.items.length && <Empty text={t(messages.noRiskCases)} />}
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
                                {t(messages.immutableAudit)}
                            </h2>
                            <div className="space-y-2">
                                {(data?.governanceAuditEntries.items ?? []).map(item => (
                                    <div key={item.id} className="rounded border p-3 text-xs">
                                        <strong>
                                            #{item.sequence} {eventTypeDisplayLabel(item.eventType)}
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
                                <CheckCircle2 className="h-4 w-4 text-blue-600" /> {t(messages.dailyReports)}
                            </h2>
                            <div className="space-y-2">
                                {(data?.governanceReports ?? []).map(report => (
                                    <div key={report.id} className="rounded border p-3 text-xs">
                                        <strong>
                                            {report.businessDate} · {t(messages.anomalies)}{' '}
                                            {report.anomalyCount}
                                        </strong>
                                        <p className="mt-1 break-all text-muted-foreground">
                                            {report.metricsJson}
                                        </p>
                                    </div>
                                ))}
                                {!data?.governanceReports.length && (
                                    <Empty text={t(messages.reportsPending)} />
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
    const { t } = useLingui();
    return (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
                className={inputClass}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={t(messages.decisionReason)}
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

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

const inputClass =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';
