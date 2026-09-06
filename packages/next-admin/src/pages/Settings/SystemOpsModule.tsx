import { useMutation, useQuery } from '@apollo/client/react';
import {
    Activity,
    AlertCircle,
    Braces,
    CalendarClock,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleStop,
    Copy,
    Gauge,
    KeyRound,
    LoaderCircle,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    Search,
    Send,
    Server,
    Settings2,
    Terminal,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getServerHealthUrl, sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import type { CustomFieldDefinition, CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    localizedCustomFieldInputFromValues,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import {
    CANCEL_JOB_MUTATION,
    CREATE_API_KEY_MUTATION,
    DELETE_API_KEYS_MUTATION,
    ROTATE_API_KEY_MUTATION,
    RUN_SCHEDULED_TASK_MUTATION,
    SET_SETTINGS_STORE_VALUE_MUTATION,
    SYSTEM_OPERATIONS_QUERY,
    UPDATE_API_KEY_MUTATION,
    UPDATE_SCHEDULED_TASK_MUTATION,
    type ApiKeyRecord,
    type ScheduledTaskRecord,
    type SettingsStoreFieldRecord,
    type SystemJobRecord,
    type SystemOperationsResult,
} from '../../graphql/management.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getRoleCodeLabel, getRoleLabel, getStatusLabel } from '../../utils/status-labels';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';
import { SettingsContentSkeleton } from './settings-ui';
import { TelegramNotificationsPanel } from './TelegramNotificationsPanel';

type Tab = 'HEALTH' | 'JOBS' | 'SCHEDULES' | 'SETTINGS' | 'API_KEYS' | 'TELEGRAM';
const SYSTEM_OPS_TABS = {
    health: 'HEALTH',
    jobs: 'JOBS',
    schedules: 'SCHEDULES',
    settings: 'SETTINGS',
    'api-keys': 'API_KEYS',
    telegram: 'TELEGRAM',
} as const;

export function SystemOpsModule() {
    const apiKeyCustomFields = useCustomFieldDefinitions('ApiKey');
    const systemOperationsDocument = useMemo(
        () => addCustomFieldsToDocument(SYSTEM_OPERATIONS_QUERY, 'ApiKey', apiKeyCustomFields),
        [apiKeyCustomFields],
    );
    const [tab, setTab] = useUrlTab<Tab>(SYSTEM_OPS_TABS, 'health');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [apiKeyPage, setApiKeyPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setApiKeyPage);
    const query = useQuery<SystemOperationsResult>(systemOperationsDocument, {
        variables: {
            jobOptions: { take: 100, sort: { createdAt: 'DESC', id: 'DESC' } },
            apiKeyOptions: {
                skip: apiKeyPage * pageSize,
                take: pageSize,
                sort: { createdAt: 'DESC', id: 'DESC' },
            },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
        pollInterval: tab === 'HEALTH' || tab === 'JOBS' || tab === 'SCHEDULES' ? 10_000 : 0,
    });
    const completed = async (message: string) => {
        setNotice(message);
        setActionError('');
        const refreshed = await query.refetch();
        const totalApiKeys = refreshed.data?.apiKeys.totalItems ?? 0;
        if (apiKeyPage > 0 && apiKeyPage * pageSize >= totalApiKeys) {
            setApiKeyPage(current => Math.max(0, current - 1));
        }
    };
    const data = query.data;
    const apiKeyTotalPages = Math.max(1, Math.ceil((data?.apiKeys.totalItems ?? 0) / pageSize));

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Terminal className="h-5 w-5 text-blue-600" />
                            系统运维
                            <FeatureHelpButton topic="settings.system-ops" title="系统运维" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            查看服务健康、任务队列、Telegram 通知、定时调度、配置仓库和 API 密钥
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        disabled={query.loading}
                        className={secondaryButton}
                    >
                        <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        刷新数据
                    </button>
                </div>
            </header>
            <main className="mx-auto min-h-0 w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                <div className="scrollbar-hidden flex w-max max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
                    <TabButton
                        active={tab === 'HEALTH'}
                        onClick={() => setTab('HEALTH')}
                        icon={<Activity className="h-3.5 w-3.5" />}
                    >
                        服务健康
                    </TabButton>
                    <TabButton
                        active={tab === 'JOBS'}
                        onClick={() => setTab('JOBS')}
                        icon={<Terminal className="h-3.5 w-3.5" />}
                    >
                        任务队列 {data?.jobs.totalItems ?? 0}
                    </TabButton>
                    <TabButton
                        active={tab === 'SCHEDULES'}
                        onClick={() => setTab('SCHEDULES')}
                        icon={<CalendarClock className="h-3.5 w-3.5" />}
                    >
                        定时任务 {data?.scheduledTasks.length ?? 0}
                    </TabButton>
                    <TabButton
                        active={tab === 'TELEGRAM'}
                        onClick={() => setTab('TELEGRAM')}
                        icon={<Send className="h-3.5 w-3.5" />}
                    >
                        Telegram 通知
                    </TabButton>
                    <TabButton
                        active={tab === 'SETTINGS'}
                        onClick={() => setTab('SETTINGS')}
                        icon={<Settings2 className="h-3.5 w-3.5" />}
                    >
                        配置仓库 {data?.settingsStoreFieldDefinitions.length ?? 0}
                    </TabButton>
                    <TabButton
                        active={tab === 'API_KEYS'}
                        onClick={() => setTab('API_KEYS')}
                        icon={<KeyRound className="h-3.5 w-3.5" />}
                    >
                        API 密钥 {data?.apiKeys.totalItems ?? 0}
                    </TabButton>
                </div>
                {tab === 'TELEGRAM' ? (
                    <TelegramNotificationsPanel />
                ) : !data && !query.error ? (
                    <SettingsContentSkeleton label="正在读取系统运维数据" sections={2} />
                ) : tab === 'HEALTH' ? (
                    <HealthPanel data={data} graphQLError={query.error?.message} />
                ) : query.error && !data ? (
                    <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                ) : (
                    data && (
                        <>
                            {tab === 'JOBS' && (
                                <JobsPanel
                                    jobs={data.jobs.items}
                                    queues={data.jobQueues}
                                    onChanged={completed}
                                    onError={setActionError}
                                />
                            )}
                            {tab === 'SCHEDULES' && (
                                <SchedulesPanel
                                    tasks={data.scheduledTasks}
                                    onChanged={completed}
                                    onError={setActionError}
                                />
                            )}
                            {tab === 'SETTINGS' && (
                                <SettingsStorePanel
                                    fields={data.settingsStoreFieldDefinitions}
                                    onChanged={completed}
                                    onError={setActionError}
                                />
                            )}
                            {tab === 'API_KEYS' && (
                                <ApiKeysPanel
                                    pageSize={pageSize}
                                    onPageSizeChange={setPageSize}
                                    keys={data.apiKeys.items}
                                    total={data.apiKeys.totalItems}
                                    page={apiKeyPage}
                                    totalPages={apiKeyTotalPages}
                                    loading={query.loading}
                                    roles={data.activeAdministrator?.user.roles ?? []}
                                    customFieldDefinitions={apiKeyCustomFields}
                                    onPageChange={setApiKeyPage}
                                    onChanged={completed}
                                    onError={setActionError}
                                />
                            )}
                        </>
                    )
                )}
            </main>
        </div>
    );
}

interface HealthResult {
    state: 'checking' | 'healthy' | 'unhealthy';
    latencyMs: number | null;
    checkedAt: string | null;
    message: string;
}

function HealthPanel({ data, graphQLError }: { data?: SystemOperationsResult; graphQLError?: string }) {
    const [health, setHealth] = useState<HealthResult>({
        state: 'checking',
        latencyMs: null,
        checkedAt: null,
        message: '正在检查服务…',
    });

    useEffect(() => {
        let disposed = false;
        const check = async () => {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 8_000);
            const startedAt = performance.now();
            try {
                const response = await fetch(getServerHealthUrl(), {
                    credentials: 'include',
                    signal: controller.signal,
                });
                const payload = (await response.json().catch(() => null)) as { status?: string } | null;
                if (!response.ok || payload?.status !== 'ok')
                    throw new Error(`健康检查返回 ${response.status}`);
                if (!disposed)
                    setHealth({
                        state: 'healthy',
                        latencyMs: Math.round(performance.now() - startedAt),
                        checkedAt: new Date().toISOString(),
                        message: '服务端健康检查通过',
                    });
            } catch (error) {
                if (!disposed)
                    setHealth({
                        state: 'unhealthy',
                        latencyMs: null,
                        checkedAt: new Date().toISOString(),
                        message:
                            error instanceof Error && error.name === 'AbortError'
                                ? '健康检查超时'
                                : toUserFacingError(error, '无法访问服务健康接口'),
                    });
            } finally {
                window.clearTimeout(timeout);
            }
        };
        void check();
        const interval = window.setInterval(() => void check(), 30_000);
        return () => {
            disposed = true;
            window.clearInterval(interval);
        };
    }, []);

    const queues = data?.jobQueues ?? [];
    const jobs = data?.jobs.items ?? [];
    const activeJobs = jobs.filter(job => !job.isSettled).length;
    const failedJobs = jobs.filter(job => ['FAILED', 'RETRYING'].includes(job.state)).length;
    const stoppedQueues = queues.filter(queue => !queue.running);
    const graphqlHealthy = Boolean(data) && !graphQLError;

    return (
        <div className="min-h-[620px] space-y-4">
            <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-5">
                <Metric
                    label="服务状态"
                    value={
                        health.state === 'checking' ? '检查中' : health.state === 'healthy' ? '正常' : '异常'
                    }
                    detail={health.message}
                    tone={
                        health.state === 'healthy' ? 'green' : health.state === 'unhealthy' ? 'rose' : 'blue'
                    }
                />
                <Metric
                    label="健康接口延迟"
                    value={health.latencyMs == null ? '—' : `${health.latencyMs} ms`}
                    detail={health.checkedAt ? `检查于 ${formatDateTime(health.checkedAt)}` : '等待首次检查'}
                    tone={health.latencyMs != null && health.latencyMs > 1000 ? 'amber' : 'slate'}
                />
                <Metric
                    label="管理 API"
                    value={graphqlHealthy ? '可用' : '异常'}
                    detail={graphQLError ? toUserFacingError(graphQLError) : '运维 GraphQL 数据读取正常'}
                    tone={graphqlHealthy ? 'green' : 'rose'}
                />
                <Metric
                    label="工作队列"
                    value={queues.length ? `${queues.length - stoppedQueues.length}/${queues.length}` : '—'}
                    detail={
                        stoppedQueues.length
                            ? `${stoppedQueues.map(queue => queue.name).join('、')} 未运行`
                            : queues.length
                              ? '全部 worker 正在运行'
                              : '尚未读取队列数据'
                    }
                    tone={stoppedQueues.length ? 'amber' : queues.length ? 'green' : 'slate'}
                />
                <Metric
                    label="近期任务"
                    value={`${activeJobs} 执行中`}
                    detail={`${failedJobs} 个失败或重试中（最近 ${jobs.length} 条）`}
                    tone={failedJobs ? 'rose' : activeJobs ? 'blue' : 'slate'}
                />
            </section>
            <section className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex items-start gap-3">
                        <div
                            className={`rounded-lg p-2 ${health.state === 'healthy' ? 'bg-emerald-50 text-emerald-700' : health.state === 'unhealthy' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}`}
                        >
                            <Server className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                服务实时检查
                                <FeatureHelpButton topic="settings.service-checks" title="服务实时检查" />
                            </h2>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                                每 30 秒请求一次后端{' '}
                                <code className="rounded bg-slate-100 px-1 font-mono text-[10px]">
                                    /health
                                </code>
                                ，并结合管理 API 和任务 worker 的真实返回判断运行状态。
                            </p>
                        </div>
                    </div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                    <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-white p-2 text-amber-700">
                            <Gauge className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-amber-950">
                                监控能力边界
                                <FeatureHelpButton topic="settings.service-checks" title="监控能力边界" />
                            </h2>
                            <p className="mt-1 text-xs leading-5 text-amber-900">
                                当前后端没有提供
                                CPU、内存、数据库连接池和请求吞吐量指标。本页不生成模拟数据；需要这些指标时，应先接入
                                Prometheus/OpenTelemetry 或增加受权限保护的监控接口。
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

function JobsPanel({
    jobs,
    queues,
    onChanged,
    onError,
}: {
    jobs: SystemJobRecord[];
    queues: Array<{ name: string; running: boolean }>;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [search, setSearch] = useState('');
    const [queue, setQueue] = useState('ALL');
    const [stateFilter, setStateFilter] = useState('ALL');
    const [cancel, cancelState] = useMutation(CANCEL_JOB_MUTATION);
    const states = [...new Set(jobs.map(job => job.state))];
    const filtered = useMemo(
        () =>
            jobs.filter(
                job =>
                    (queue === 'ALL' || job.queueName === queue) &&
                    (stateFilter === 'ALL' || job.state === stateFilter) &&
                    (!search.trim() ||
                        `${job.id} ${job.queueName} ${job.error ?? ''}`
                            .toLowerCase()
                            .includes(search.trim().toLowerCase())),
            ),
        [jobs, queue, search, stateFilter],
    );
    const cancelJob = async (job: SystemJobRecord) => {
        if (
            job.isSettled ||
            !(await requestConfirmation({
                title: `取消任务 ${job.id}？`,
                description: '任务可能已经完成了部分业务操作，取消后不会自动回滚。',
                confirmLabel: '确认取消任务',
                tone: 'danger',
            }))
        )
            return;
        try {
            await cancel({ variables: { jobId: job.id } });
            await onChanged('任务取消请求已提交');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <div className="space-y-4">
            <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3 xl:grid-cols-5">
                <Metric
                    label="队列数"
                    value={String(queues.length)}
                    detail={`${queues.filter(item => item.running).length} 个正在运行`}
                />
                <Metric label="最近任务" value={String(jobs.length)} detail="最多读取最近 100 条" />
                <Metric
                    label="执行中"
                    value={String(jobs.filter(job => !job.isSettled).length)}
                    detail="自动每 10 秒刷新"
                    tone="blue"
                />
                <Metric
                    label="失败"
                    value={String(jobs.filter(job => ['FAILED', 'RETRYING'].includes(job.state)).length)}
                    detail="查看真实错误原因"
                    tone="rose"
                />
                <Metric
                    label="队列状态"
                    value={queues.every(item => item.running) ? '正常' : '需检查'}
                    detail={
                        queues
                            .filter(item => !item.running)
                            .map(item => item.name)
                            .join('、') || '全部 worker 已运行'
                    }
                    tone={queues.every(item => item.running) ? 'green' : 'amber'}
                />
            </section>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            任务执行记录
                            <FeatureHelpButton topic="settings.job-runs" title="任务执行记录" />
                        </h2>
                        <p className="mt-1 text-[10px] text-slate-400">
                            Vendure 不提供通用“重试任意任务”接口，因此这里只允许取消未完成任务
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <input
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                aria-label="搜索后台任务"
                                placeholder="搜索任务 ID、队列或错误"
                                className={`${inputClass} w-60 pl-8`}
                            />
                        </div>
                        <select
                            value={queue}
                            onChange={event => setQueue(event.target.value)}
                            className={inputClass}
                        >
                            <option value="ALL">全部队列</option>
                            {queues.map(item => (
                                <option key={item.name} value={item.name}>
                                    {item.name}
                                </option>
                            ))}
                        </select>
                        <select
                            value={stateFilter}
                            onChange={event => setStateFilter(event.target.value)}
                            className={inputClass}
                        >
                            <option value="ALL">全部状态</option>
                            {states.map(state => (
                                <option key={state} value={state}>
                                    {jobStateLabel(state)}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1680px] border-collapse text-left text-xs">
                        <thead>
                            <tr className={theadClass}>
                                <th
                                    scope="col"
                                    className="sticky left-0 z-20 w-56 whitespace-nowrap bg-slate-50 px-3 py-3"
                                >
                                    任务 ID
                                </th>
                                <th scope="col" className="w-48 whitespace-nowrap px-3 py-3">
                                    队列
                                </th>
                                <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                    状态
                                </th>
                                <th scope="col" className="w-20 whitespace-nowrap px-3 py-3">
                                    进度
                                </th>
                                <th scope="col" className="w-20 whitespace-nowrap px-3 py-3">
                                    尝试次数
                                </th>
                                <th scope="col" className="w-20 whitespace-nowrap px-3 py-3">
                                    最大次数
                                </th>
                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                    创建时间
                                </th>
                                <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                    耗时
                                </th>
                                <th scope="col" className="w-72 whitespace-nowrap px-3 py-3">
                                    错误
                                </th>
                                <th
                                    scope="col"
                                    className="sticky right-0 z-20 w-28 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                >
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map(job => (
                                <tr key={job.id} className="group h-[52px] hover:bg-slate-50">
                                    <td className="sticky left-0 z-10 h-[52px] max-w-56 bg-white px-3 py-0 group-hover:bg-slate-50">
                                        <span
                                            className="block truncate font-mono text-[10px] font-bold text-slate-700"
                                            title={job.id}
                                        >
                                            {job.id}
                                        </span>
                                    </td>
                                    <td className="h-[52px] max-w-48 px-3 py-0 text-[10px] text-slate-500">
                                        <span className="block truncate" title={job.queueName}>
                                            {job.queueName}
                                        </span>
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                        <JobStateBadge state={job.state} />
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold text-slate-700">
                                        {Math.round(job.progress)}%
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {job.attempts}
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {job.retries + 1}
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {formatDateTime(job.createdAt)}
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {formatDuration(job.duration)}
                                    </td>
                                    <td className="h-[52px] max-w-72 px-3 py-0">
                                        <span
                                            className="block truncate text-[10px] text-rose-600"
                                            title={job.error ?? ''}
                                        >
                                            {job.error ?? '—'}
                                        </span>
                                    </td>
                                    <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 text-right group-hover:bg-slate-50">
                                        {!job.isSettled && (
                                            <button
                                                type="button"
                                                onClick={() => void cancelJob(job)}
                                                disabled={cancelState.loading}
                                                className={`${secondaryButton} ml-auto text-rose-600`}
                                            >
                                                <CircleStop className="h-3.5 w-3.5" />
                                                取消
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {!filtered.length && <EmptyRow colSpan={10} text="当前条件下没有任务记录" />}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function SchedulesPanel({
    tasks,
    onChanged,
    onError,
}: {
    tasks: ScheduledTaskRecord[];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [update, updateState] = useMutation(UPDATE_SCHEDULED_TASK_MUTATION);
    const [run, runState] = useMutation<{ runScheduledTask: { success: boolean } }>(
        RUN_SCHEDULED_TASK_MUTATION,
    );
    const toggle = async (task: ScheduledTaskRecord) => {
        try {
            await update({ variables: { input: { id: task.id, enabled: !task.enabled } } });
            await onChanged(`定时任务已${task.enabled ? '停用' : '启用'}`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    const execute = async (task: ScheduledTaskRecord) => {
        if (
            !(await requestConfirmation({
                title: `立即执行“${task.description || task.id}”？`,
                description: '该任务可能更新或清理系统数据，并且会与正常调度并行执行。',
                confirmLabel: '立即执行',
                tone: 'warning',
            }))
        )
            return;
        try {
            const response = await run({ variables: { id: task.id } });
            if (!response.data?.runScheduledTask.success) throw new Error('后端未接受执行请求');
            await onChanged('定时任务已进入执行队列');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const busy = updateState.loading || runState.loading;
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    定时任务调度
                    <FeatureHelpButton topic="settings.schedules" title="定时任务调度" />
                </h2>
                <p className="mt-1 text-xs text-slate-400">启停和立即执行均直接调用服务端调度器</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1720px] border-collapse text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th
                                scope="col"
                                className="sticky left-0 z-20 w-56 whitespace-nowrap bg-slate-50 px-3 py-3"
                            >
                                任务名称
                            </th>
                            <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                任务 ID
                            </th>
                            <th scope="col" className="w-48 whitespace-nowrap px-3 py-3">
                                调度说明
                            </th>
                            <th scope="col" className="w-44 whitespace-nowrap px-3 py-3">
                                Cron
                            </th>
                            <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                状态
                            </th>
                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                上次执行
                            </th>
                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                下次执行
                            </th>
                            <th scope="col" className="w-72 whitespace-nowrap px-3 py-3">
                                最近结果
                            </th>
                            <th
                                scope="col"
                                className="sticky right-0 z-20 w-52 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                            >
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {tasks.map(task => (
                            <tr key={task.id} className="group h-[52px] hover:bg-slate-50">
                                <td className="sticky left-0 z-10 h-[52px] max-w-56 bg-white px-3 py-0 group-hover:bg-slate-50">
                                    <span
                                        className="block truncate font-bold text-slate-800"
                                        title={task.description || task.id}
                                    >
                                        {task.description || task.id}
                                    </span>
                                </td>
                                <td className="h-[52px] max-w-56 px-3 py-0 font-mono text-[9px] text-slate-500">
                                    <span className="block truncate" title={task.id}>
                                        {task.id}
                                    </span>
                                </td>
                                <td className="h-[52px] max-w-48 px-3 py-0">
                                    <span className="block truncate" title={task.scheduleDescription}>
                                        {task.scheduleDescription}
                                    </span>
                                </td>
                                <td className="h-[52px] max-w-44 px-3 py-0 font-mono text-[9px] text-slate-500">
                                    <span className="block truncate" title={task.schedule}>
                                        {task.schedule}
                                    </span>
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                    <span
                                        className={`rounded px-2 py-1 text-[9px] font-bold ${task.isRunning ? 'bg-blue-50 text-blue-700' : task.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                                    >
                                        {task.isRunning ? '执行中' : task.enabled ? '已启用' : '已停用'}
                                    </span>
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                    {task.lastExecutedAt ? formatDateTime(task.lastExecutedAt) : '从未执行'}
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                    {task.nextExecutionAt ? formatDateTime(task.nextExecutionAt) : '无计划'}
                                </td>
                                <td className="h-[52px] max-w-72 px-3 py-0">
                                    <code
                                        className="block truncate text-[9px] text-slate-500"
                                        title={formatJson(task.lastResult)}
                                    >
                                        {task.lastResult == null ? '—' : formatJson(task.lastResult)}
                                    </code>
                                </td>
                                <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 group-hover:bg-slate-50">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void toggle(task)}
                                            disabled={busy || task.isRunning}
                                            className={secondaryButton}
                                        >
                                            {task.enabled ? '停用' : '启用'}
                                        </button>
                                        {task.enabled && (
                                            <button
                                                type="button"
                                                onClick={() => void execute(task)}
                                                disabled={busy || task.isRunning}
                                                className={primaryButton}
                                            >
                                                <Play className="h-3.5 w-3.5" />
                                                立即执行
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!tasks.length && <EmptyRow colSpan={9} text="服务端没有注册定时任务" />}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function SettingsStorePanel({
    fields,
    onChanged,
    onError,
}: {
    fields: SettingsStoreFieldRecord[];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [search, setSearch] = useState('');
    const [scope, setScope] = useState('ALL');
    const [editor, setEditor] = useState<SettingsStoreFieldRecord | null>(null);
    const [save, state] = useMutation<{ setSettingsStoreValue: { result: boolean; error: string | null } }>(
        SET_SETTINGS_STORE_VALUE_MUTATION,
    );
    const filtered = fields.filter(
        field =>
            (scope === 'ALL' || field.scopeType === scope) &&
            (!search.trim() || field.key.toLowerCase().includes(search.trim().toLowerCase())),
    );
    const update = async (field: SettingsStoreFieldRecord, value: unknown) => {
        try {
            const response = await save({ variables: { input: { key: field.key, value } } });
            const result = response.data?.setSettingsStoreValue;
            if (!result?.result) throw new Error(result?.error || '保存失败');
            setEditor(null);
            await onChanged(`配置 ${field.key} 已更新`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        动态配置仓库
                        <FeatureHelpButton topic="settings.dynamic-config" title="动态配置仓库" />
                    </h2>
                    <p className="mt-1 text-[10px] text-slate-400">
                        字段、作用域、只读状态和值全部由服务端注册；JSON 会保留原始类型
                    </p>
                </div>
                <div className="flex gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <input
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            aria-label="搜索系统配置"
                            placeholder="搜索配置键"
                            className={`${inputClass} w-60 pl-8`}
                        />
                    </div>
                    <select
                        value={scope}
                        onChange={event => setScope(event.target.value)}
                        className={inputClass}
                    >
                        <option value="ALL">全部作用域</option>
                        {['GLOBAL', 'CHANNEL', 'USER', 'USER_AND_CHANNEL', 'CUSTOM'].map(value => (
                            <option key={value} value={value}>
                                {scopeLabel(value)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="divide-y divide-slate-100">
                {filtered.map(field => (
                    <div
                        key={field.key}
                        className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between"
                    >
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="font-mono text-xs font-bold text-slate-800">
                                    {field.key}
                                </code>
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-[9px] text-slate-600">
                                    {scopeLabel(field.scopeType)}
                                </span>
                                {field.readonly && (
                                    <span className="rounded bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">
                                        只读
                                    </span>
                                )}
                            </div>
                            <code
                                className="mt-2 block max-w-4xl truncate text-[10px] text-slate-500"
                                title={formatJson(field.currentValue)}
                            >
                                {formatJson(field.currentValue)}
                            </code>
                        </div>
                        {!field.readonly &&
                            (typeof field.currentValue === 'boolean' ? (
                                <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={field.currentValue}
                                        onChange={event => void update(field, event.target.checked)}
                                        disabled={state.loading}
                                    />
                                    {field.currentValue ? '已开启' : '已关闭'}
                                </label>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setEditor(field)}
                                    className={secondaryButton}
                                >
                                    <Braces className="h-3.5 w-3.5" />
                                    编辑值
                                </button>
                            ))}
                    </div>
                ))}
                {!filtered.length && (
                    <div className="p-12 text-center text-xs text-slate-400">当前条件下没有配置项</div>
                )}
            </div>
            {editor && (
                <SettingsValueEditor
                    field={editor}
                    saving={state.loading}
                    onClose={() => setEditor(null)}
                    onSave={value => void update(editor, value)}
                    onError={onError}
                />
            )}
        </section>
    );
}

function ApiKeysPanel({
    pageSize,
    onPageSizeChange,
    keys,
    total,
    page,
    totalPages,
    loading,
    roles,
    customFieldDefinitions,
    onPageChange,
    onChanged,
    onError,
}: {
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    keys: ApiKeyRecord[];
    total: number;
    page: number;
    totalPages: number;
    loading: boolean;
    roles: Array<{ id: string; code: string; description: string }>;
    customFieldDefinitions: CustomFieldDefinition[];
    onPageChange: (page: number) => void;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [createOpen, setCreateOpen] = useState(false);
    const [editingKey, setEditingKey] = useState<ApiKeyRecord | null>(null);
    const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
    const [rotate, rotateState] = useMutation<{ rotateApiKey: { apiKey: string } }>(ROTATE_API_KEY_MUTATION);
    const [remove, removeState] = useMutation<{
        deleteApiKeys: Array<{ result: string; message: string | null }>;
    }>(DELETE_API_KEYS_MUTATION);
    const rotateKey = async (key: ApiKeyRecord) => {
        const confirmation = await requestConfirmation({
            title: `轮转 API 密钥“${key.name}”？`,
            description: '旧密钥会立即失效。请确保依赖该密钥的外部系统可以及时更新。',
            confirmLabel: '确认轮转',
            tone: 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await rotate({
                variables: { id: key.id },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const value = response.data?.rotateApiKey.apiKey;
            if (!value) throw new Error('后端未返回新密钥');
            setSecret({ title: `${key.name} 的新密钥`, value });
            await onChanged('API 密钥已轮转，旧密钥已失效');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const destroy = async (key: ApiKeyRecord) => {
        const confirmation = await requestConfirmation({
            title: `永久删除 API 密钥“${key.name}”？`,
            description: '依赖该密钥的外部系统将立即无法访问，此操作不可恢复。',
            confirmLabel: '永久删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await remove({
                variables: { ids: [key.id] },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const result = response.data?.deleteApiKeys[0];
            if (!result || result.result !== 'DELETED') throw new Error(result?.message || '删除失败');
            await onChanged('API 密钥已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const busy = rotateState.loading || removeState.loading;
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        API 密钥
                        <FeatureHelpButton topic="settings.api-keys" title="API 密钥" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">密钥明文只在创建或轮转成功后显示一次</p>
                </div>
                <button type="button" onClick={() => setCreateOpen(true)} className={primaryButton}>
                    <Plus className="h-3.5 w-3.5" />
                    创建密钥
                </button>
            </div>
            <div className="divide-y divide-slate-100">
                {keys.map(key => (
                    <div
                        key={key.id}
                        className="flex flex-col gap-4 p-5 xl:flex-row xl:items-center xl:justify-between"
                    >
                        <div>
                            <div className="flex items-center gap-2">
                                <KeyRound className="h-4 w-4 text-blue-600" />
                                <strong className="text-xs text-slate-900">{key.name}</strong>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                                <span>
                                    Lookup ID：
                                    <code className="font-mono text-slate-600">{key.lookupId}</code>
                                </span>
                                <span>创建者：{key.owner?.identifier ?? '—'}</span>
                                <span>
                                    最近使用：{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : '从未使用'}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setEditingKey(key)}
                                disabled={busy}
                                className={secondaryButton}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                                编辑
                            </button>
                            <button
                                type="button"
                                onClick={() => void rotateKey(key)}
                                disabled={busy}
                                className={secondaryButton}
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                轮转
                            </button>
                            <button
                                type="button"
                                onClick={() => void destroy(key)}
                                disabled={busy}
                                className={`${secondaryButton} text-rose-600`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                删除
                            </button>
                        </div>
                    </div>
                ))}
                {!keys.length && (
                    <div className="p-12 text-center text-xs text-slate-400">当前页没有 API 密钥</div>
                )}
            </div>
            <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                <span>
                    共 {total} 条，第 {page + 1}/{totalPages} 页
                </span>
                <div className="flex flex-wrap items-center gap-2">
                    <PageSizeSelect
                        pageSize={pageSize}
                        onPageSizeChange={onPageSizeChange}
                        disabled={loading}
                    />
                    <button
                        type="button"
                        disabled={page === 0 || loading}
                        onClick={() => onPageChange(page - 1)}
                        className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                        aria-label="上一页"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        disabled={page + 1 >= totalPages || loading}
                        onClick={() => onPageChange(page + 1)}
                        className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                        aria-label="下一页"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
            {createOpen && (
                <CreateApiKeyDialog
                    roles={roles}
                    onClose={() => setCreateOpen(false)}
                    onCreated={async value => {
                        setCreateOpen(false);
                        setSecret({ title: '新 API 密钥', value });
                        await onChanged('API 密钥已创建');
                    }}
                    onError={onError}
                />
            )}
            {editingKey && (
                <EditApiKeyDialog
                    item={editingKey}
                    roles={roles}
                    customFieldDefinitions={customFieldDefinitions}
                    onClose={() => setEditingKey(null)}
                    onSaved={async () => {
                        setEditingKey(null);
                        await onChanged('API 密钥名称、角色与扩展字段已更新');
                    }}
                    onError={onError}
                />
            )}
            {secret && (
                <SecretDialog title={secret.title} value={secret.value} onClose={() => setSecret(null)} />
            )}
        </section>
    );
}

function EditApiKeyDialog({
    item,
    roles,
    customFieldDefinitions,
    onClose,
    onSaved,
    onError,
}: {
    item: ApiKeyRecord;
    roles: Array<{ id: string; code: string; description: string }>;
    customFieldDefinitions: CustomFieldDefinition[];
    onClose: () => void;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const sourceTranslation = item.translations[0];
    const [name, setName] = useState(item.name);
    const [roleIds, setRoleIds] = useState(item.user.roles.map(role => role.id));
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(() =>
        customFieldValuesFromEntity(customFieldDefinitions, item.customFields, item.translations),
    );
    const updateDocument = useMemo(
        () => addCustomFieldsToDocument(UPDATE_API_KEY_MUTATION, 'ApiKey', customFieldDefinitions),
        [customFieldDefinitions],
    );
    const [update, state] = useMutation(updateDocument);
    const submit = async () => {
        if (!name.trim() || !roleIds.length) return onError('请填写用途名称并至少选择一个角色');
        const languageCode = sourceTranslation?.languageCode ?? 'zh_Hans';
        const customFieldErrors = validateCustomFieldValues(
            customFieldDefinitions,
            customFieldValues,
            languageCode,
        );
        if (Object.keys(customFieldErrors).length > 0) {
            return onError(Object.values(customFieldErrors)[0] ?? 'API 密钥扩展字段校验失败');
        }
        const confirmation = await requestConfirmation({
            title: `更新 API 密钥“${item.name}”？`,
            description: '角色变更会立即影响该密钥可访问的管理 API，请验证当前管理员密码。',
            confirmLabel: '验证并更新',
            tone: 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await update({
                variables: {
                    input: {
                        id: item.id,
                        roleIds,
                        customFields: customFieldInputFromValues(customFieldDefinitions, customFieldValues),
                        translations: (item.translations.length
                            ? item.translations
                            : [{ id: '', languageCode, name: item.name }]
                        ).map(translation => ({
                            ...(translation.id ? { id: translation.id } : {}),
                            languageCode: translation.languageCode,
                            name: translation.languageCode === languageCode ? name.trim() : translation.name,
                            customFields: localizedCustomFieldInputFromValues(
                                customFieldDefinitions,
                                customFieldValues,
                                translation.languageCode,
                            ),
                        })),
                    },
                },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            if (!(response.data as { updateApiKey?: { id?: string } } | undefined)?.updateApiKey?.id) {
                throw new Error('后端未返回更新后的 API 密钥');
            }
            await onSaved();
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="编辑 API 密钥"
            description="可修改用途名称、关联角色和动态扩展字段；密钥值本身不会改变"
            onClose={onClose}
        >
            <Field label="用途名称 *">
                <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    className={inputClass}
                    autoFocus
                />
            </Field>
            <div className="mt-5">
                <div className="mb-2 text-xs font-bold text-slate-700">分配角色 *</div>
                <div className="space-y-2">
                    {roles.map(role => (
                        <label
                            key={role.id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs"
                        >
                            <input
                                type="checkbox"
                                checked={roleIds.includes(role.id)}
                                onChange={() =>
                                    setRoleIds(current =>
                                        current.includes(role.id)
                                            ? current.filter(id => id !== role.id)
                                            : [...current, role.id],
                                    )
                                }
                            />
                            <span>
                                <strong className="text-slate-800">{getRoleLabel(role)}</strong>
                                <code className="ml-2 font-mono text-[9px] text-slate-400">
                                    {getRoleCodeLabel(role.code)}
                                </code>
                            </span>
                        </label>
                    ))}
                </div>
            </div>
            <div className="mt-5">
                <DynamicCustomFieldsForm
                    helpTopic="settings.dynamic-config"
                    title="API 密钥扩展字段"
                    fields={customFieldDefinitions}
                    values={customFieldValues}
                    onChange={setCustomFieldValues}
                    disabled={state.loading}
                />
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="更新密钥"
            />
        </Modal>
    );
}

function CreateApiKeyDialog({
    roles,
    onClose,
    onCreated,
    onError,
}: {
    roles: Array<{ id: string; code: string; description: string }>;
    onClose: () => void;
    onCreated: (value: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [name, setName] = useState('');
    const [roleIds, setRoleIds] = useState<string[]>([]);
    const [create, state] = useMutation<{ createApiKey: { apiKey: string } }>(CREATE_API_KEY_MUTATION);
    const submit = async () => {
        if (!name.trim() || !roleIds.length) return onError('请填写用途名称并至少选择一个角色');
        try {
            const response = await create({
                variables: {
                    input: { roleIds, translations: [{ languageCode: 'zh_Hans', name: name.trim() }] },
                },
            });
            const value = response.data?.createApiKey.apiKey;
            if (!value) throw new Error('后端未返回密钥');
            await onCreated(value);
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal title="创建 API 密钥" description="密钥只能获得当前账号已有的角色权限" onClose={onClose}>
            <Field label="用途名称 *">
                <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    className={inputClass}
                    placeholder="例如：ERP 订单同步"
                    autoFocus
                />
            </Field>
            <div className="mt-5">
                <div className="mb-2 text-xs font-bold text-slate-700">分配角色 *</div>
                <div className="space-y-2">
                    {roles.map(role => (
                        <label
                            key={role.id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs"
                        >
                            <input
                                type="checkbox"
                                checked={roleIds.includes(role.id)}
                                onChange={() =>
                                    setRoleIds(current =>
                                        current.includes(role.id)
                                            ? current.filter(id => id !== role.id)
                                            : [...current, role.id],
                                    )
                                }
                            />
                            <span>
                                <strong className="text-slate-800">{getRoleLabel(role)}</strong>
                                <code className="ml-2 font-mono text-[9px] text-slate-400">
                                    {getRoleCodeLabel(role.code)}
                                </code>
                            </span>
                        </label>
                    ))}
                </div>
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="创建密钥"
            />
        </Modal>
    );
}

function SecretDialog({ title, value, onClose }: { title: string; value: string; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    return (
        <Modal title={title} description="请立即复制并安全保存，关闭后无法再次查看" onClose={onClose}>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <code className="select-all break-all text-xs font-bold leading-6 text-amber-950">
                    {value}
                </code>
            </div>
            <div className="mt-5 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={async () => {
                        await navigator.clipboard.writeText(value);
                        setCopied(true);
                    }}
                    className={secondaryButton}
                >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? '已复制' : '复制密钥'}
                </button>
                <button type="button" onClick={onClose} className={primaryButton}>
                    我已安全保存
                </button>
            </div>
        </Modal>
    );
}

function SettingsValueEditor({
    field,
    saving,
    onClose,
    onSave,
    onError,
}: {
    field: SettingsStoreFieldRecord;
    saving: boolean;
    onClose: () => void;
    onSave: (value: unknown) => void;
    onError: (message: string) => void;
}) {
    const complex = typeof field.currentValue === 'object' && field.currentValue !== null;
    const [draft, setDraft] = useState(
        complex ? JSON.stringify(field.currentValue, null, 2) : String(field.currentValue ?? ''),
    );
    const submit = () => {
        try {
            if (complex) return onSave(JSON.parse(draft));
            if (typeof field.currentValue === 'number') {
                const value = Number(draft);
                if (!Number.isFinite(value)) throw new Error('请输入有效数字');
                return onSave(value);
            }
            onSave(draft);
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={`编辑 ${field.key}`}
            description={`作用域：${scopeLabel(field.scopeType)}；将按 ${complex ? 'JSON' : typeof field.currentValue} 类型保存`}
            onClose={onClose}
        >
            <textarea
                rows={complex ? 16 : 5}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                className={`${inputClass} font-mono leading-5`}
                spellCheck={false}
            />
            <ModalActions onClose={onClose} onSave={submit} saving={saving} saveLabel="保存配置" />
        </Modal>
    );
}
function JobStateBadge({ state }: { state: string }) {
    const classes = ['COMPLETED'].includes(state)
        ? 'bg-emerald-50 text-emerald-700'
        : ['FAILED', 'CANCELLED'].includes(state)
          ? 'bg-rose-50 text-rose-700'
          : ['RUNNING', 'STARTED'].includes(state)
            ? 'bg-blue-50 text-blue-700'
            : 'bg-amber-50 text-amber-700';
    return (
        <span className={`rounded px-2 py-1 text-[9px] font-bold ${classes}`}>{jobStateLabel(state)}</span>
    );
}
function jobStateLabel(state: string) {
    const labels: Record<string, string> = {
        PENDING: '等待中',
        RUNNING: '执行中',
        STARTED: '执行中',
        RETRYING: '重试中',
        COMPLETED: '已完成',
        FAILED: '失败',
        CANCELLED: '已取消',
    };
    return labels[state] ?? getStatusLabel(state);
}
function scopeLabel(scope: string) {
    const labels: Record<string, string> = {
        GLOBAL: '全局',
        CHANNEL: '当前渠道',
        USER: '当前用户',
        USER_AND_CHANNEL: '用户与渠道',
        CUSTOM: '自定义',
    };
    return labels[scope] ?? scope;
}
function formatDuration(duration: number) {
    if (!duration) return '—';
    return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s`;
}
function formatJson(value: unknown) {
    if (value == null) return '—';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
function Metric({
    label,
    value,
    detail,
    tone = 'slate',
}: {
    label: string;
    value: string;
    detail: string;
    tone?: 'slate' | 'blue' | 'green' | 'amber' | 'rose';
}) {
    const colors = {
        slate: 'text-slate-900',
        blue: 'text-blue-700',
        green: 'text-emerald-700',
        amber: 'text-amber-700',
        rose: 'text-rose-700',
    };
    return (
        <div className="border-b border-slate-100 p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[9px] font-bold text-slate-400">{label}</div>
            <div className={`mt-1 text-lg font-bold ${colors[tone]}`}>{value}</div>
            <div className="mt-1 truncate text-[9px] text-slate-400" title={detail}>
                {detail}
            </div>
        </div>
    );
}
function TabButton({
    active,
    onClick,
    icon,
    children,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold ${active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
        >
            {icon}
            {children}
        </button>
    );
}
function Modal({
    title,
    description,
    onClose,
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="font-bold text-slate-900">{title}</h2>
                        {description && (
                            <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </AccessibleDialogSurface>
        </div>
    );
}
function ModalActions({
    onClose,
    onSave,
    saving,
    saveLabel,
}: {
    onClose: () => void;
    onSave: () => void;
    saving: boolean;
    saveLabel: string;
}) {
    return (
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
                取消
            </button>
            <button type="button" onClick={onSave} disabled={saving} className={primaryButton}>
                {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                {saveLabel}
            </button>
        </div>
    );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}
function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
    return (
        <tr>
            <td colSpan={colSpan} className="p-12 text-center text-xs text-slate-400">
                {text}
            </td>
        </tr>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">系统运维数据加载失败</h2>
            <p className="mt-1 max-w-lg text-xs text-rose-600">{toUserFacingError(message)}</p>
            <button type="button" onClick={onRetry} className={`${secondaryButton} mt-4`}>
                重试
            </button>
        </div>
    );
}
function Message({
    kind,
    onClose,
    children,
}: {
    kind: 'success' | 'error';
    onClose: () => void;
    children: React.ReactNode;
}) {
    const success = kind === 'success';
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            {success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="flex-1">{children}</span>
            <button type="button" onClick={onClose} aria-label="关闭">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
function errorText(error: unknown) {
    return toUserFacingError(error, '系统运维操作失败，请稍后重试');
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400';
const primaryButton =
    'flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
    'flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const theadClass = 'border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500';
