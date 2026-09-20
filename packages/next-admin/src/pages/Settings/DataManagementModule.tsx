import { gql } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArchiveRestore,
    CheckCircle2,
    Database,
    LoaderCircle,
    RefreshCw,
    RotateCcw,
    ShieldAlert,
    ShieldCheck,
    UserRound,
    X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';

const DATA_RETENTION_QUERY = gql`
    query DataRetentionRecords {
        dataRetentionRecords {
            id
            createdAt
            updatedAt
            channelId
            resourceType
            resourceKey
            policyCode
            reason
            status
            quarantinedAt
            purgeAfter
            nextAttemptAt
            legalHold
            legalHoldReason
            legalHoldChangedByUserId
            legalHoldChangedAt
            attemptCount
            lastAttemptAt
            lastError
            completedAt
        }
        dataSubjectRequests {
            id
            createdAt
            channelId
            requestType
            status
            requestedAt
            dueAt
            nextAttemptAt
            lastAttemptAt
            attemptCount
            blockersJson
            lastError
            resultDigest
            resultSummaryJson
            completedAt
            cancelledAt
        }
    }
`;

const SET_LEGAL_HOLD_MUTATION = gql`
    mutation SetDataRetentionLegalHold($id: ID!, $enabled: Boolean!, $reason: String) {
        setDataRetentionLegalHold(id: $id, enabled: $enabled, reason: $reason) {
            id
            status
            legalHold
            legalHoldReason
            legalHoldChangedAt
            nextAttemptAt
            updatedAt
        }
    }
`;

const RETRY_RETENTION_MUTATION = gql`
    mutation RetryDataRetentionRecord($id: ID!) {
        retryDataRetentionRecord(id: $id) {
            id
            status
            nextAttemptAt
            lastError
            updatedAt
        }
    }
`;

const RETRY_DATA_SUBJECT_MUTATION = gql`
    mutation RetryDataSubjectRequest($id: ID!) {
        retryDataSubjectRequest(id: $id) {
            id
            status
            nextAttemptAt
            lastError
            updatedAt
        }
    }
`;

type RetentionStatus = 'PENDING' | 'BLOCKED_REFERENCE' | 'FAILED' | 'RESTORED' | 'PURGED';

interface RetentionRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    channelId: string;
    resourceType: string;
    resourceKey: string;
    policyCode: string;
    reason: string;
    status: RetentionStatus;
    quarantinedAt: string;
    purgeAfter: string;
    nextAttemptAt?: string | null;
    legalHold: boolean;
    legalHoldReason?: string | null;
    legalHoldChangedByUserId?: string | null;
    legalHoldChangedAt?: string | null;
    attemptCount: number;
    lastAttemptAt?: string | null;
    lastError?: string | null;
    completedAt?: string | null;
}

type SubjectRequestStatus = 'PENDING' | 'PROCESSING' | 'BLOCKED' | 'FAILED' | 'FULFILLED' | 'CANCELLED';

interface SubjectRequest {
    id: string;
    createdAt: string;
    channelId: string;
    requestType: 'EXPORT' | 'ACCOUNT_CLOSURE';
    status: SubjectRequestStatus;
    requestedAt: string;
    dueAt?: string | null;
    nextAttemptAt?: string | null;
    lastAttemptAt?: string | null;
    attemptCount: number;
    blockersJson?: string | null;
    lastError?: string | null;
    resultDigest?: string | null;
    resultSummaryJson?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
}

const filters = ['ACTIVE', 'ALL', 'PENDING', 'BLOCKED_REFERENCE', 'FAILED', 'RESTORED', 'PURGED'] as const;
type Filter = (typeof filters)[number];

export function DataManagementModule() {
    const query = useQuery<{
        dataRetentionRecords: RetentionRecord[];
        dataSubjectRequests: SubjectRequest[];
    }>(DATA_RETENTION_QUERY, {
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [setLegalHold, holdState] = useMutation(SET_LEGAL_HOLD_MUTATION);
    const [retryRetention, retryState] = useMutation(RETRY_RETENTION_MUTATION);
    const [retryDataSubject, retrySubjectState] = useMutation(RETRY_DATA_SUBJECT_MUTATION);
    const requestConfirmation = useConfirmDialog();
    const [filter, setFilter] = useState<Filter>('ACTIVE');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [holdTarget, setHoldTarget] = useState<RetentionRecord | null>(null);
    const [holdReason, setHoldReason] = useState('');
    const records = useMemo(() => query.data?.dataRetentionRecords ?? [], [query.data?.dataRetentionRecords]);
    const subjectRequests = useMemo(
        () => query.data?.dataSubjectRequests ?? [],
        [query.data?.dataSubjectRequests],
    );
    const visible = useMemo(
        () =>
            records.filter(record => {
                if (filter === 'ALL') return true;
                if (filter === 'ACTIVE')
                    return ['PENDING', 'BLOCKED_REFERENCE', 'FAILED'].includes(record.status);
                return record.status === filter;
            }),
        [filter, records],
    );
    const counts = useMemo(
        () => ({
            pending: records.filter(record => record.status === 'PENDING').length,
            blocked: records.filter(record => record.status === 'BLOCKED_REFERENCE').length,
            failed: records.filter(record => record.status === 'FAILED').length,
            held: records.filter(record => record.legalHold).length,
        }),
        [records],
    );
    const busy = holdState.loading || retryState.loading || retrySubjectState.loading;

    const refresh = async (message?: string) => {
        await query.refetch();
        if (message) setNotice(message);
        setActionError('');
    };

    const applyHold = async () => {
        if (!holdTarget || !holdReason.trim()) return;
        try {
            await setLegalHold({
                variables: { id: holdTarget.id, enabled: true, reason: holdReason.trim() },
            });
            setHoldTarget(null);
            setHoldReason('');
            await refresh('法律保留已生效，定时清理不会删除该资源');
        } catch (error) {
            setActionError(toUserFacingError(error, '设置法律保留失败'));
        }
    };

    const releaseHold = async (record: RetentionRecord) => {
        if (
            !(await requestConfirmation({
                title: '解除数据法律保留？',
                description: '解除后，如果该记录已到清理时间，定时任务会在再次检查引用后尝试删除资源。',
                confirmLabel: '解除保留',
                tone: 'warning',
            }))
        )
            return;
        try {
            await setLegalHold({ variables: { id: record.id, enabled: false, reason: null } });
            await refresh('法律保留已解除');
        } catch (error) {
            setActionError(toUserFacingError(error, '解除法律保留失败'));
        }
    };

    const retry = async (record: RetentionRecord) => {
        try {
            await retryRetention({ variables: { id: record.id } });
            await refresh('已安排重试；仍会执行引用与保留检查');
        } catch (error) {
            setActionError(toUserFacingError(error, '重试安排失败'));
        }
    };

    const retrySubjectRequest = async (request: SubjectRequest) => {
        try {
            await retryDataSubject({ variables: { id: request.id } });
            await refresh('账户注销请求已安排重试，业务阻断仍会重新检查');
        } catch (error) {
            setActionError(toUserFacingError(error, '数据请求重试失败'));
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Database className="h-5 w-5 text-blue-600" />
                            数据管理中心
                            <FeatureHelpButton topic="settings.data-management" title="数据管理中心" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            查看数据恢复区、到期清理、个人数据导出、账户注销、失败重试和法律保留记录
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        disabled={query.loading}
                        className="flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>
            </header>
            <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && <Message kind="success" text={notice} onClose={() => setNotice('')} />}
                {actionError && (
                    <Message kind="error" text={actionError} onClose={() => setActionError('')} />
                )}
                <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-950">
                    <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                            <strong>安全边界：</strong>
                            活跃用户当前头像不会因时间自动删除。只有更换或移除后的旧头像会进入30天恢复区；到期仍会检查业务引用和法律保留。
                        </p>
                    </div>
                </section>
                <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="等待到期" value={counts.pending} tone="blue" />
                    <Metric label="引用阻断" value={counts.blocked} tone="amber" />
                    <Metric label="清理失败" value={counts.failed} tone="rose" />
                    <Metric label="法律保留" value={counts.held} tone="violet" />
                </section>
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-sm font-bold text-slate-900">保留与清理记录</h2>
                            <p className="mt-1 text-[11px] text-slate-500">
                                最新 100 条；已删除的资源仍保留审计记录
                            </p>
                        </div>
                        <select
                            value={filter}
                            onChange={event => setFilter(event.target.value as Filter)}
                            aria-label="筛选数据保留状态"
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                        >
                            {filters.map(value => (
                                <option value={value} key={value}>
                                    {filterLabel(value)}
                                </option>
                            ))}
                        </select>
                    </div>
                    {query.loading && !query.data ? (
                        <div className="flex items-center justify-center gap-2 p-12 text-xs text-slate-500">
                            <LoaderCircle className="h-4 w-4 animate-spin" /> 正在读取数据保留记录…
                        </div>
                    ) : query.error && !query.data ? (
                        <div className="p-8 text-center text-xs text-rose-600">
                            {toUserFacingError(query.error, '数据保留记录读取失败')}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1320px] border-collapse text-left text-xs">
                                <thead className="bg-slate-50 text-[11px] font-bold text-slate-500">
                                    <tr>
                                        <th className="px-4 py-3">资源</th>
                                        <th className="px-4 py-3">状态</th>
                                        <th className="px-4 py-3">原因</th>
                                        <th className="px-4 py-3">进入恢复区</th>
                                        <th className="px-4 py-3">计划清理</th>
                                        <th className="px-4 py-3">尝试</th>
                                        <th className="px-4 py-3">异常/保留</th>
                                        <th className="px-4 py-3 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {visible.map(record => (
                                        <tr key={record.id} className="hover:bg-slate-50/70">
                                            <td className="px-4 py-3">
                                                <strong className="block text-slate-800">
                                                    {resourceLabel(record.resourceType)}
                                                </strong>
                                                <span className="mt-1 block font-mono text-[10px] text-slate-400">
                                                    #{record.resourceKey} · 店铺 {record.channelId}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusBadge record={record} />
                                            </td>
                                            <td className="px-4 py-3 text-slate-600">
                                                {reasonLabel(record.reason)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 font-mono text-[10px] text-slate-500">
                                                {formatDateTime(record.quarantinedAt)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 font-mono text-[10px] text-slate-500">
                                                {formatDateTime(record.purgeAfter)}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600">
                                                {record.attemptCount}
                                            </td>
                                            <td className="max-w-80 px-4 py-3">
                                                <span
                                                    className={
                                                        record.legalHold
                                                            ? 'text-violet-700'
                                                            : record.lastError
                                                              ? 'text-rose-600'
                                                              : 'text-slate-400'
                                                    }
                                                >
                                                    {record.legalHold
                                                        ? `法律保留：${record.legalHoldReason ?? '未说明'}`
                                                        : (record.lastError ?? '—')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-2">
                                                    {record.legalHold ? (
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => void releaseHold(record)}
                                                            className={buttonClass}
                                                        >
                                                            <ShieldAlert className="h-3.5 w-3.5" /> 解除保留
                                                        </button>
                                                    ) : record.status !== 'PURGED' &&
                                                      record.status !== 'RESTORED' ? (
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => {
                                                                setHoldTarget(record);
                                                                setHoldReason('');
                                                            }}
                                                            className={buttonClass}
                                                        >
                                                            <ShieldCheck className="h-3.5 w-3.5" /> 法律保留
                                                        </button>
                                                    ) : null}
                                                    {['FAILED', 'BLOCKED_REFERENCE'].includes(
                                                        record.status,
                                                    ) &&
                                                        !record.legalHold && (
                                                            <button
                                                                type="button"
                                                                disabled={busy}
                                                                onClick={() => void retry(record)}
                                                                className={buttonClass}
                                                            >
                                                                <RotateCcw className="h-3.5 w-3.5" /> 重试
                                                            </button>
                                                        )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {!visible.length && (
                                        <tr>
                                            <td
                                                colSpan={8}
                                                className="px-4 py-12 text-center text-xs text-slate-400"
                                            >
                                                当前条件下没有保留记录
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 p-4">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            <UserRound className="h-4 w-4 text-indigo-600" />
                            个人数据与账户注销请求
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-500">
                            导出仅保留摘要和校验值，不保存文件正文；注销有 7 天冷静期和业务阻断检查
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
                            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500">
                                <tr>
                                    <th className="px-4 py-3">请求</th>
                                    <th className="px-4 py-3">状态</th>
                                    <th className="px-4 py-3">申请时间</th>
                                    <th className="px-4 py-3">计划处理</th>
                                    <th className="px-4 py-3">尝试</th>
                                    <th className="px-4 py-3">阻断/错误</th>
                                    <th className="px-4 py-3 text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {subjectRequests.map(request => (
                                    <tr key={request.id} className="hover:bg-slate-50/70">
                                        <td className="px-4 py-3">
                                            <strong className="block text-slate-800">
                                                {request.requestType === 'EXPORT'
                                                    ? '个人数据导出'
                                                    : '账户注销'}
                                            </strong>
                                            <span className="mt-1 block font-mono text-[10px] text-slate-400">
                                                #{request.id} · 店铺 {request.channelId}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <SubjectStatusBadge status={request.status} />
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[10px] text-slate-500">
                                            {formatDateTime(request.requestedAt)}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[10px] text-slate-500">
                                            {request.dueAt ? formatDateTime(request.dueAt) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{request.attemptCount}</td>
                                        <td className="max-w-96 px-4 py-3 text-rose-600">
                                            {request.lastError ?? '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {request.requestType === 'ACCOUNT_CLOSURE' &&
                                                ['BLOCKED', 'FAILED'].includes(request.status) && (
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={() => void retrySubjectRequest(request)}
                                                        className={buttonClass}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5" /> 重试
                                                    </button>
                                                )}
                                        </td>
                                    </tr>
                                ))}
                                {!subjectRequests.length && (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="px-4 py-12 text-center text-xs text-slate-400"
                                        >
                                            暂无个人数据请求
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
            {holdTarget && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4">
                    <AccessibleDialogSurface
                        accessibleName="设置数据法律保留"
                        onRequestClose={() => setHoldTarget(null)}
                        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-base font-bold text-slate-900">设置法律保留</h2>
                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                    保留期间定时任务不会删除该资源，必须记录业务或法律原因。
                                </p>
                            </div>
                            <button type="button" onClick={() => setHoldTarget(null)} aria-label="关闭">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <textarea
                            autoFocus
                            value={holdReason}
                            onChange={event => setHoldReason(event.target.value)}
                            maxLength={500}
                            rows={4}
                            placeholder="例如：退款争议处理中，需保留相关资料"
                            className="mt-4 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => setHoldTarget(null)} className={buttonClass}>
                                取消
                            </button>
                            <button
                                type="button"
                                disabled={!holdReason.trim() || holdState.loading}
                                onClick={() => void applyHold()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                {holdState.loading ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <ArchiveRestore className="h-3.5 w-3.5" />
                                )}
                                启用保留
                            </button>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function Metric({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: 'blue' | 'amber' | 'rose' | 'violet';
}) {
    const colors = {
        blue: 'text-blue-700',
        amber: 'text-amber-700',
        rose: 'text-rose-700',
        violet: 'text-violet-700',
    };
    return (
        <div className="border-b border-slate-100 p-4 last:border-0 sm:border-b-0 sm:border-r">
            <span className="text-[11px] font-bold text-slate-500">{label}</span>
            <strong className={`mt-2 block text-2xl ${colors[tone]}`}>{value}</strong>
        </div>
    );
}

function StatusBadge({ record }: { record: RetentionRecord }) {
    const styles: Record<RetentionStatus, string> = {
        PENDING: 'bg-blue-50 text-blue-700',
        BLOCKED_REFERENCE: 'bg-amber-50 text-amber-700',
        FAILED: 'bg-rose-50 text-rose-700',
        RESTORED: 'bg-emerald-50 text-emerald-700',
        PURGED: 'bg-slate-100 text-slate-600',
    };
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${record.legalHold ? 'bg-violet-50 text-violet-700' : styles[record.status]}`}
        >
            {record.legalHold ? (
                <ShieldCheck className="h-3 w-3" />
            ) : record.status === 'FAILED' ? (
                <AlertCircle className="h-3 w-3" />
            ) : (
                <CheckCircle2 className="h-3 w-3" />
            )}
            {record.legalHold ? '法律保留' : statusLabel(record.status)}
        </span>
    );
}

function SubjectStatusBadge({ status }: { status: SubjectRequestStatus }) {
    const styles: Record<SubjectRequestStatus, string> = {
        PENDING: 'bg-blue-50 text-blue-700',
        PROCESSING: 'bg-indigo-50 text-indigo-700',
        BLOCKED: 'bg-amber-50 text-amber-700',
        FAILED: 'bg-rose-50 text-rose-700',
        FULFILLED: 'bg-emerald-50 text-emerald-700',
        CANCELLED: 'bg-slate-100 text-slate-600',
    };
    const labels: Record<SubjectRequestStatus, string> = {
        PENDING: '冷静期/等待',
        PROCESSING: '处理中',
        BLOCKED: '业务阻断',
        FAILED: '处理失败',
        FULFILLED: '已完成',
        CANCELLED: '已撤销',
    };
    return (
        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${styles[status]}`}>
            {labels[status]}
        </span>
    );
}

function statusLabel(value: RetentionStatus) {
    return {
        PENDING: '等待到期',
        BLOCKED_REFERENCE: '引用阻断',
        FAILED: '清理失败',
        RESTORED: '已恢复',
        PURGED: '已清理',
    }[value];
}

function filterLabel(value: Filter) {
    if (value === 'ACTIVE') return '待处理';
    if (value === 'ALL') return '全部记录';
    return statusLabel(value);
}

function resourceLabel(value: string) {
    return value === 'CUSTOMER_AVATAR' ? '用户头像' : value;
}

function reasonLabel(value: string) {
    return (
        {
            REPLACED: '用户更换',
            REMOVED: '用户移除',
            RESTORE_REPLACEMENT: '恢复历史头像时替换',
            ACCOUNT_CLOSURE: '账户注销',
        }[value] ?? value
    );
}

function Message({ kind, text, onClose }: { kind: 'success' | 'error'; text: string; onClose: () => void }) {
    return (
        <div
            role={kind === 'error' ? 'alert' : 'status'}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-xs ${kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            <span>{text}</span>
            <button type="button" onClick={onClose} aria-label="关闭">
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

const buttonClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
