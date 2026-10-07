import { useMutation } from '@apollo/client/react';
import {
    AlertTriangle,
    Bot,
    CheckCircle2,
    LoaderCircle,
    RefreshCw,
    RotateCcw,
    Save,
    Send,
    ShieldAlert,
    X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { getSystemLabel } from '../../../../common/src/display-localization';
import {
    departmentDisplayLabel,
    eventTypeDisplayLabel,
    severityDisplayLabel,
    systemStatusDisplayLabel,
} from '../../../../common/src/system-display-labels';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { CUSTOMER_SERVICE_REVIEWS_QUERY } from '../../graphql/telegram-notifications.graphql';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';

import {
    ACKNOWLEDGE_ADMIN_INCIDENT,
    COMPLETE_ADMIN_INCIDENT_ACTION,
    RETRY_TELEGRAM_NOTIFICATION,
    SEND_TELEGRAM_NOTIFICATION_TEST,
    SUBMIT_ADMIN_INCIDENT_REVIEW,
    TELEGRAM_NOTIFICATIONS_QUERY,
    TEST_TELEGRAM_CONNECTION,
    UPDATE_TELEGRAM_NOTIFICATION_CONFIG,
    VALIDATE_ADMIN_INCIDENT_RECOVERY,
    type TelegramDepartmentRouteOverrideRecord,
    type TelegramNotificationConfigRecord,
    type TelegramNotificationsResult,
} from '../../graphql/telegram-notifications.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';

type Draft = Pick<
    TelegramNotificationConfigRecord,
    | 'enabled'
    | 'chatId'
    | 'adminBaseUrl'
    | 'timezone'
    | 'minSeverity'
    | 'sendResolved'
    | 'p2Silent'
    | 'p3Silent'
    | 'notifyOrderEvents'
    | 'notifyPaymentEvents'
    | 'notifyFulfillmentEvents'
    | 'notifyRefundEvents'
    | 'notifyInventoryEvents'
    | 'notifyOnlineReports'
    | 'notifyServiceReviews'
    | 'notifyPromotionExpiry'
    | 'notifyAiCredentials'
    | 'notifySecurityEvents'
    | 'inventoryLowThreshold'
    | 'p1EscalationMinutes'
    | 'p0RepeatMinutes'
    | 'p1RepeatMinutes'
    | 'departmentMentions'
    | 'routeOverrides'
>;

const testKinds = [
    ['NORMAL', '普通测试'],
    ['P0', '危急告警测试'],
    ['ORDER', '订单测试'],
    ['INVENTORY', '库存测试'],
    ['RESOLVED', '恢复测试'],
] as const;

type IncidentDialogKind = 'ACKNOWLEDGE' | 'RECOVERY' | 'REVIEW' | 'ACTION';

interface IncidentDialogDraft {
    kind: IncidentDialogKind;
    id: string;
    label: string;
    note: string;
    rootCause: string;
    impactSummary: string;
    actionTitle: string;
    ownerDepartmentCode: string;
    dueAt: string;
}

export function TelegramNotificationsPanel() {
    const [reviewPage, setReviewPage] = useState(0);
    const [notificationSection, setNotificationSection] = useState('config');
    const reviewQuery = useQuery<{
        customerServiceReviews: {
            totalItems: number;
            items: Array<{
                id: string;
                createdAt: string;
                channelId: string;
                rating: number;
                tags: string[];
                comment: string;
                orderCode: string | null;
            }>;
        };
    }>(CUSTOMER_SERVICE_REVIEWS_QUERY, {
        variables: { skip: reviewPage * 25, take: 25, allStores: true },
    });
    const [statusFilter, setStatusFilter] = useState('');
    const [editedDraft, setDraft] = useState<Draft | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [incidentDialog, setIncidentDialog] = useState<IncidentDialogDraft | null>(null);
    const query = useQuery<TelegramNotificationsResult>(TELEGRAM_NOTIFICATIONS_QUERY, {
        variables: { skip: 0, take: 25, status: statusFilter || null },

        notifyOnNetworkStatusChange: true,
        pollInterval: 10_000,
    });
    const [saveConfig, saveState] = useMutation(UPDATE_TELEGRAM_NOTIFICATION_CONFIG);
    const [testConnection, connectionState] = useMutation<{
        testTelegramConnection: {
            ok: boolean;
            message: string;
            botUsername: string | null;
            testedAt: string;
        };
    }>(TEST_TELEGRAM_CONNECTION);
    const [sendTest, sendState] = useMutation(SEND_TELEGRAM_NOTIFICATION_TEST);
    const [retryDelivery, retryState] = useMutation(RETRY_TELEGRAM_NOTIFICATION);
    const [acknowledgeIncident, acknowledgeState] = useMutation(ACKNOWLEDGE_ADMIN_INCIDENT);
    const [validateRecovery, recoveryState] = useMutation(VALIDATE_ADMIN_INCIDENT_RECOVERY);
    const [submitReview, reviewState] = useMutation(SUBMIT_ADMIN_INCIDENT_REVIEW);
    const [completeAction, actionState] = useMutation(COMPLETE_ADMIN_INCIDENT_ACTION);
    const config = query.data?.telegramNotificationConfig;
    const draft = editedDraft ?? (config ? draftFromConfig(config) : null);

    const complete = async (message: string) => {
        setNotice(message);
        setError('');
        await query.refetch();
    };
    const fail = (caught: unknown) => {
        setNotice('');
        setError(toUserFacingError(caught));
    };
    const save = async () => {
        if (!draft || !config) return;
        try {
            const input = config.chatIdSource === 'ENVIRONMENT' ? { ...draft, chatId: undefined } : draft;
            await saveConfig({ variables: { input } });
            setDraft(null);
            await complete('Telegram 内部通知配置已保存');
        } catch (caught) {
            fail(caught);
        }
    };
    const checkConnection = async () => {
        try {
            const response = await testConnection();
            const result = response.data?.testTelegramConnection;
            if (!result?.ok) throw new Error(result?.message || 'Telegram 连接检测失败');
            await complete(result.message);
        } catch (caught) {
            fail(caught);
        }
    };
    const test = async (kind: string) => {
        try {
            await sendTest({ variables: { kind } });
            await complete('测试消息已写入可靠发送队列');
        } catch (caught) {
            fail(caught);
        }
    };
    const retry = async (id: string) => {
        try {
            await retryDelivery({ variables: { id } });
            await complete('通知 ' + id + ' 已重新进入发送队列');
        } catch (caught) {
            fail(caught);
        }
    };
    const openIncidentNoteAction = (
        kind: 'ACKNOWLEDGE' | 'RECOVERY' | 'ACTION',
        id: string,
        label: string,
    ) => {
        setIncidentDialog({
            kind,
            id,
            label,
            note: '',
            rootCause: '',
            impactSummary: '',
            actionTitle: '',
            ownerDepartmentCode: '',
            dueAt: '',
        });
    };
    const openIncidentReview = (id: string, ownerDepartmentCode: string) => {
        setIncidentDialog({
            kind: 'REVIEW',
            id,
            label: '提交事故复盘',
            note: '',
            rootCause: '',
            impactSummary: '',
            actionTitle: '',
            ownerDepartmentCode,
            dueAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString().slice(0, 16),
        });
    };
    const submitIncidentDialog = async () => {
        if (!incidentDialog || !incidentDialogValid(incidentDialog)) return;
        try {
            if (incidentDialog.kind === 'ACKNOWLEDGE') {
                await acknowledgeIncident({
                    variables: { id: incidentDialog.id, note: incidentDialog.note.trim() },
                });
            } else if (incidentDialog.kind === 'RECOVERY') {
                await validateRecovery({
                    variables: { id: incidentDialog.id, note: incidentDialog.note.trim() },
                });
            } else if (incidentDialog.kind === 'ACTION') {
                await completeAction({
                    variables: { actionId: incidentDialog.id, note: incidentDialog.note.trim() },
                });
            } else {
                await submitReview({
                    variables: {
                        id: incidentDialog.id,
                        input: {
                            rootCause: incidentDialog.rootCause.trim(),
                            impactSummary: incidentDialog.impactSummary.trim(),
                            correctiveActions: [
                                {
                                    title: incidentDialog.actionTitle.trim(),
                                    ownerDepartmentCode: incidentDialog.ownerDepartmentCode,
                                    dueAt: new Date(incidentDialog.dueAt).toISOString(),
                                },
                            ],
                        },
                    },
                });
            }
            const completedLabel = incidentDialog.label;
            setIncidentDialog(null);
            await complete(completedLabel + '已记录');
        } catch (caught) {
            fail(caught);
        }
    };
    const updateRouteOverride = (
        eventType: string,
        patch: Partial<TelegramDepartmentRouteOverrideRecord>,
    ) => {
        if (!draft) return;
        const current = draft.routeOverrides.find(item => item.eventType === eventType) ?? { eventType };
        setDraft({
            ...draft,
            routeOverrides: [
                ...draft.routeOverrides.filter(item => item.eventType !== eventType),
                { ...current, ...patch },
            ],
        });
    };
    const resetRouteOverride = (eventType: string) => {
        if (!draft) return;
        setDraft({
            ...draft,
            routeOverrides: draft.routeOverrides.filter(item => item.eventType !== eventType),
        });
    };

    if (query.loading && !query.data) return <LoadingState />;
    if (query.error && !query.data) {
        return (
            <ErrorState
                message={toUserFacingError(query.error, 'Telegram 通知配置读取失败')}
                onRetry={() => void query.refetch()}
            />
        );
    }
    if (!config || !draft || !query.data) {
        return <ErrorState message="Telegram 配置数据不完整" onRetry={() => void query.refetch()} />;
    }

    const runtime = query.data.telegramNotificationStatus;
    const audits = query.data.telegramNotificationConfigAudits;
    const deliveries = query.data.telegramNotificationDeliveries;
    const incidents = query.data.adminIncidents;
    const routing = query.data.telegramDepartmentRouting;
    const busy =
        saveState.loading ||
        connectionState.loading ||
        sendState.loading ||
        retryState.loading ||
        acknowledgeState.loading ||
        recoveryState.loading ||
        reviewState.loading ||
        actionState.loading;

    return (
        <div className="space-y-4">
            {notice && <Message tone="success">{notice}</Message>}
            {error && <Message tone="error">{error}</Message>}

            <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-5">
                <Metric
                    label="通知开关"
                    value={config.enabled ? '已启用' : '已停用'}
                    detail="一个 Bot · 一个私密群"
                    tone={config.enabled ? 'green' : 'slate'}
                />
                <Metric
                    label="机器人凭证"
                    value={config.tokenConfigured ? '已配置' : '未配置'}
                    detail="仅从服务端环境变量读取"
                    tone={config.tokenConfigured ? 'green' : 'rose'}
                />
                <Metric
                    label="工作进程"
                    value={runtime.running ? '运行中' : '未检测到'}
                    detail={runtime.processed + ' 成功 · ' + runtime.failures + ' 失败'}
                    tone={runtime.running ? 'green' : 'amber'}
                />
                <Metric
                    label="待发送 / 重试"
                    value={runtime.pending + ' / ' + runtime.retrying}
                    detail={'最老等待 ' + duration(runtime.oldestLagSeconds)}
                    tone={runtime.retrying ? 'amber' : 'blue'}
                />
                <Metric
                    label="死信"
                    value={String(runtime.dead)}
                    detail={
                        runtime.lastSuccessAt
                            ? '最近成功 ' + formatDateTime(runtime.lastSuccessAt)
                            : '尚无成功记录'
                    }
                    tone={runtime.dead ? 'rose' : 'green'}
                />
            </section>

            <nav
                className="admin-comparison-scroll rounded-xl border border-slate-200 bg-white p-1"
                aria-label="消息通知分区"
            >
                <div className="flex w-max min-w-full gap-1">
                    {(
                        [
                            ['config', '连接与策略'],
                            ['routing', '部门路由'],
                            ['incidents', '事故闭环'],
                            ['deliveries', '发送记录'],
                            ['reviews', '服务评价'],
                            ['audits', '配置审计'],
                        ] as const
                    ).map(([key, label]) => (
                        <AdminButton
                            key={key}
                            type="button"
                            onClick={() => setNotificationSection(key)}
                            aria-pressed={notificationSection === key}
                            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${notificationSection === key ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
                        >
                            {label}
                        </AdminButton>
                    ))}
                </div>
            </nav>
            <section
                hidden={notificationSection !== 'config'}
                style={notificationSection === 'config' ? undefined : { display: 'none' }}
                className="rounded-xl border border-slate-200 bg-white p-5"
            >
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="rounded-lg bg-blue-50 p-2 text-blue-700">
                            <Bot className="h-5 w-5" />
                        </span>
                        <div>
                            <h2 className="admin-section-title-line text-sm font-bold text-slate-900">
                                Telegram 连接与策略
                                <span className="text-xs font-normal text-slate-500">
                                    机器人连接与通知规则
                                </span>
                                <FeatureHelpButton
                                    topic="settings.telegram"
                                    title="Telegram 连接与策略"
                                    description={'机器人凭证仅由服务器安全配置；所有店铺共用现有接收群。'}
                                />
                            </h2>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <AdminButton
                            type="button"
                            onClick={() => void checkConnection()}
                            disabled={busy || !config.tokenConfigured}
                            className={secondaryButton}
                        >
                            <RefreshCw
                                className={'h-3.5 w-3.5 ' + (connectionState.loading ? 'animate-spin' : '')}
                            />
                            检测 Bot
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={() => void save()}
                            disabled={busy}
                            className={primaryButton}
                        >
                            <Save className="h-3.5 w-3.5" />
                            保存配置
                        </AdminButton>
                    </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Toggle
                        label="启用内部通知"
                        checked={draft.enabled}
                        onChange={enabled => setDraft({ ...draft, enabled })}
                    />
                    <Field label="接收群编号" hint={'来源：' + sourceLabel(config.chatIdSource)}>
                        <AdminInput
                            value={draft.chatId ?? ''}
                            onChange={event => setDraft({ ...draft, chatId: event.target.value || null })}
                            disabled={config.chatIdSource === 'ENVIRONMENT'}
                            placeholder="-100xxxxxxxxxx"
                            inputMode="numeric"
                            className={inputClass}
                        />
                    </Field>
                    <Field label="管理后台地址">
                        <AdminInput
                            value={draft.adminBaseUrl ?? ''}
                            onChange={event =>
                                setDraft({ ...draft, adminBaseUrl: event.target.value || null })
                            }
                            placeholder="https://console.example.com/dashboard"
                            className={inputClass}
                        />
                    </Field>
                    <Field label="时区">
                        <AdminInput
                            value={draft.timezone}
                            onChange={event => setDraft({ ...draft, timezone: event.target.value })}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="最低通知等级">
                        <AdminSelect
                            value={draft.minSeverity}
                            onChange={event => setDraft({ ...draft, minSeverity: event.target.value })}
                            className={inputClass}
                        >
                            {['P0', 'P1', 'P2', 'P3'].map(value => (
                                <option key={value} value={value}>
                                    {displayState(value)}
                                </option>
                            ))}
                        </AdminSelect>
                    </Field>
                    <NumberField
                        label="库存告警阈值"
                        value={draft.inventoryLowThreshold}
                        minimum={0}
                        onChange={inventoryLowThreshold => setDraft({ ...draft, inventoryLowThreshold })}
                    />
                    <NumberField
                        label="重要告警超时升级（分钟）"
                        value={draft.p1EscalationMinutes}
                        minimum={1}
                        onChange={p1EscalationMinutes => setDraft({ ...draft, p1EscalationMinutes })}
                    />
                    <NumberField
                        label="危急告警重复提醒（分钟）"
                        value={draft.p0RepeatMinutes}
                        minimum={1}
                        onChange={p0RepeatMinutes => setDraft({ ...draft, p0RepeatMinutes })}
                    />
                    <NumberField
                        label="重要告警重复提醒（分钟）"
                        value={draft.p1RepeatMinutes}
                        minimum={1}
                        onChange={p1RepeatMinutes => setDraft({ ...draft, p1RepeatMinutes })}
                    />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Toggle
                        label="订单事件"
                        checked={draft.notifyOrderEvents}
                        onChange={notifyOrderEvents => setDraft({ ...draft, notifyOrderEvents })}
                    />
                    <Toggle
                        label="支付事件"
                        checked={draft.notifyPaymentEvents}
                        onChange={notifyPaymentEvents => setDraft({ ...draft, notifyPaymentEvents })}
                    />
                    <Toggle
                        label="履约事件"
                        checked={draft.notifyFulfillmentEvents}
                        onChange={notifyFulfillmentEvents => setDraft({ ...draft, notifyFulfillmentEvents })}
                    />
                    <Toggle
                        label="退款事件"
                        checked={draft.notifyRefundEvents}
                        onChange={notifyRefundEvents => setDraft({ ...draft, notifyRefundEvents })}
                    />
                    <Toggle
                        label="库存事件"
                        checked={draft.notifyInventoryEvents}
                        onChange={notifyInventoryEvents => setDraft({ ...draft, notifyInventoryEvents })}
                    />
                    <Toggle
                        label="每小时全店在线汇报"
                        checked={draft.notifyOnlineReports}
                        onChange={notifyOnlineReports => setDraft({ ...draft, notifyOnlineReports })}
                    />
                    <Toggle
                        label="客服评价"
                        checked={draft.notifyServiceReviews}
                        onChange={notifyServiceReviews => setDraft({ ...draft, notifyServiceReviews })}
                    />
                    <Toggle
                        label="优惠到期提前三天"
                        checked={draft.notifyPromotionExpiry}
                        onChange={notifyPromotionExpiry => setDraft({ ...draft, notifyPromotionExpiry })}
                    />
                    <Toggle
                        label="AI 调用凭证异常"
                        checked={draft.notifyAiCredentials}
                        onChange={notifyAiCredentials => setDraft({ ...draft, notifyAiCredentials })}
                    />
                    <Toggle
                        label="账号与系统安全"
                        checked={draft.notifySecurityEvents}
                        onChange={notifySecurityEvents => setDraft({ ...draft, notifySecurityEvents })}
                    />
                    <Toggle
                        label="发送恢复通知"
                        checked={draft.sendResolved}
                        onChange={sendResolved => setDraft({ ...draft, sendResolved })}
                    />
                    <Toggle
                        label="P2 默认静音"
                        checked={draft.p2Silent}
                        onChange={p2Silent => setDraft({ ...draft, p2Silent })}
                    />
                    <Toggle
                        label="P3 默认静音"
                        checked={draft.p3Silent}
                        onChange={p3Silent => setDraft({ ...draft, p3Silent })}
                    />
                </div>

                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <strong className="text-slate-800">连接状态</strong>
                        <span className={config.tokenConfigured ? badgeGreen : badgeRose}>
                            凭证 {config.tokenConfigured ? '已配置' : '未配置'}
                        </span>
                        <span className={config.chatId ? badgeGreen : badgeRose}>
                            接收群编号 {config.chatId ? '已配置' : '未配置'}
                        </span>
                        {config.botUsername && <span className={badgeBlue}>@{config.botUsername}</span>}
                        {config.lastConnectionAt && (
                            <span className="text-slate-500">
                                最近检测 {formatDateTime(config.lastConnectionAt)}
                            </span>
                        )}
                    </div>
                    {config.lastConnectionError && (
                        <p className="mt-2 text-xs text-rose-700">{config.lastConnectionError}</p>
                    )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    {testKinds.map(([kind, label]) => (
                        <AdminButton
                            key={kind}
                            type="button"
                            onClick={() => void test(kind)}
                            disabled={busy || !config.enabled || !config.tokenConfigured || !config.chatId}
                            className={secondaryButton}
                        >
                            <Send className="h-3.5 w-3.5" />
                            {label}
                        </AdminButton>
                    ))}
                </div>
            </section>

            <section
                hidden={notificationSection !== 'reviews'}
                style={notificationSection === 'reviews' ? undefined : { display: 'none' }}
                className="rounded-xl border border-slate-200 bg-white p-5"
            >
                <h2 className="admin-section-title-line text-sm font-bold">
                    全店客服服务评价
                    <span className="text-xs font-normal text-slate-500">全店服务反馈</span>
                    <FeatureHelpButton topic="settings.telegram" title="全店客服服务评价" />
                </h2>
                {reviewQuery.loading && !reviewQuery.data && <p role="status">正在读取评价…</p>}
                {reviewQuery.error && <p role="alert">评价读取失败，请刷新后重试</p>}
                {!reviewQuery.loading &&
                    !reviewQuery.error &&
                    !reviewQuery.data?.customerServiceReviews?.items.length && (
                        <p className="mt-3 text-sm text-slate-500">暂无服务评价</p>
                    )}
                <div
                    className="admin-comparison-scroll mt-3"
                    role="region"
                    tabIndex={0}
                    aria-label="服务评价表，可横向滚动"
                >
                    <table className="admin-compact-table w-full min-w-[1130px] table-fixed text-left text-xs">
                        <colgroup>
                            <col className="w-[120px]" />
                            <col className="w-[80px]" />
                            <col className="w-[130px]" />
                            <col className="w-[150px]" />
                            <col className="w-[150px]" />
                            <col className="w-[340px]" />
                            <col className="w-[160px]" />
                        </colgroup>
                        <thead className={tableHeadClass}>
                            <tr>
                                {[
                                    '店铺编号',
                                    '评分',
                                    '处理提示',
                                    '订单编号',
                                    '标签',
                                    '文字意见',
                                    '创建时间',
                                ].map(label => (
                                    <th key={label} scope="col">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {reviewQuery.data?.customerServiceReviews?.items.map(review => (
                                <tr key={review.id}>
                                    <td data-label="店铺编号">{review.channelId}</td>
                                    <td data-label="评分">{review.rating} 星</td>
                                    <td data-label="处理提示">{review.rating <= 2 ? '需要处理' : '—'}</td>
                                    <td data-label="订单编号">{review.orderCode || '未关联订单'}</td>
                                    <td data-label="标签">
                                        <span className="block truncate" title={review.tags.join('、')}>
                                            {review.tags.join('、') || '—'}
                                        </span>
                                    </td>
                                    <td data-label="文字意见">
                                        <span
                                            className="block truncate"
                                            title={review.comment || '未填写文字意见'}
                                        >
                                            {review.comment || '未填写文字意见'}
                                        </span>
                                    </td>
                                    <td data-label="创建时间" className="whitespace-nowrap">
                                        {formatDateTime(review.createdAt)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="mt-3 flex items-center gap-3 text-sm">
                    <AdminButton
                        className={secondaryButton}
                        disabled={reviewPage === 0 || reviewQuery.loading}
                        onClick={() => setReviewPage(page => page - 1)}
                    >
                        上一页
                    </AdminButton>
                    <span>
                        第 {reviewPage + 1} 页，共 {reviewQuery.data?.customerServiceReviews?.totalItems ?? 0}{' '}
                        条
                    </span>
                    <AdminButton
                        className={secondaryButton}
                        disabled={
                            reviewQuery.loading ||
                            (reviewPage + 1) * 25 >=
                                (reviewQuery.data?.customerServiceReviews?.totalItems ?? 0)
                        }
                        onClick={() => setReviewPage(page => page + 1)}
                    >
                        下一页
                    </AdminButton>
                </div>
            </section>
            <section
                hidden={notificationSection !== 'audits'}
                style={notificationSection === 'audits' ? undefined : { display: 'none' }}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
                <div className="border-b border-slate-100 p-5">
                    <h2 className="admin-section-title-line text-sm font-bold text-slate-900">
                        配置变更审计
                        <span className="text-xs font-normal text-slate-500">最近 10 次后台修改</span>
                        <FeatureHelpButton
                            topic="settings.telegram"
                            title="Telegram 配置变更审计"
                            description={
                                '保留最近 10 次后台修改；接收群编号 在审计记录中脱敏，机器人凭证 始终不入库。'
                            }
                        />
                    </h2>
                </div>
                <div
                    className="admin-comparison-scroll"
                    role="region"
                    tabIndex={0}
                    aria-label="配置变更审计表，可横向滚动"
                >
                    <table className="admin-compact-table w-full min-w-[800px] table-fixed text-left text-xs">
                        <colgroup>
                            <col className="w-[180px]" />
                            <col className="w-[150px]" />
                            <col />
                        </colgroup>
                        <thead className={tableHeadClass}>
                            <tr>
                                <th scope="col">时间</th>
                                <th scope="col">操作人</th>
                                <th scope="col">修改字段</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {audits.map(audit => (
                                <tr key={audit.id}>
                                    <td data-label="时间" className="whitespace-nowrap text-slate-500">
                                        {formatDateTime(audit.createdAt)}
                                    </td>
                                    <td data-label="操作人">{audit.actorUserId ?? '系统'}</td>
                                    <td data-label="修改字段">
                                        <span
                                            className="block truncate"
                                            title={
                                                Object.keys(audit.changes).map(configFieldLabel).join('、') ||
                                                '无'
                                            }
                                        >
                                            {Object.keys(audit.changes).map(configFieldLabel).join('、') ||
                                                '无'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!audits.length && <p className="p-5 text-xs text-slate-400">暂无配置变更记录</p>}
            </section>

            <section
                hidden={notificationSection !== 'routing'}
                style={notificationSection === 'routing' ? undefined : { display: 'none' }}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
                <div className="border-b border-slate-100 p-5">
                    <h2 className="admin-section-title-line text-sm font-bold text-slate-900">
                        部门责任路由
                        <span className="text-xs font-normal text-slate-500">分工、升级与处理时限</span>
                        <FeatureHelpButton
                            topic="settings.telegram"
                            title="部门责任路由"
                            description={
                                '危急告警立即升级至总经办；重要告警按配置时限升级。提及对象只用于 危急和重要告警。修改后需点击上方“保存配置”。'
                            }
                        />
                    </h2>
                </div>
                <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-4">
                    {routing.departments.map(department => (
                        <Field key={department.code} label={department.nameZh}>
                            <AdminInput
                                value={draft.departmentMentions[department.code] ?? ''}
                                onChange={event =>
                                    setDraft({
                                        ...draft,
                                        departmentMentions: {
                                            ...draft.departmentMentions,
                                            [department.code]: event.target.value,
                                        },
                                    })
                                }
                                placeholder="@username（可选）"
                                className={inputClass}
                            />
                        </Field>
                    ))}
                </div>
                <div className="admin-comparison-scroll">
                    <table className="admin-compact-table w-full min-w-[1180px] border-collapse text-left text-xs">
                        <thead>
                            <tr className={tableHeadClass}>
                                <th className="px-4 py-3">事件</th>
                                <th className="px-4 py-3">等级</th>
                                <th className="px-4 py-3">主责</th>
                                <th className="px-4 py-3">协作</th>
                                <th className="px-4 py-3">升级</th>
                                <th className="px-4 py-3">需处理</th>
                                <th className="px-4 py-3">处理时限</th>
                                <th className="px-4 py-3">处理建议</th>
                                <th
                                    scope="col"
                                    className="sticky right-0 w-28 bg-slate-50 px-4 py-3 text-right"
                                >
                                    路由操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {routing.routes.map(route => {
                                const override = draft.routeOverrides.find(
                                    item => item.eventType === route.eventType,
                                );
                                const owner = override?.owner ?? route.defaultOwner;
                                const collaborators = override?.collaborators ?? route.defaultCollaborators;
                                const escalation = override
                                    ? override.escalation === undefined
                                        ? route.defaultEscalation
                                        : override.escalation
                                    : route.defaultEscalation;
                                const slaMinutes = override
                                    ? override.slaMinutes === undefined
                                        ? route.defaultSlaMinutes
                                        : override.slaMinutes
                                    : route.defaultSlaMinutes;
                                const actionRequired =
                                    override?.actionRequired ?? route.defaultActionRequired;
                                return (
                                    <tr key={route.eventType} className="hover:bg-slate-50">
                                        <td
                                            data-label="事件"
                                            className="px-4 py-3 font-mono text-[10px] text-slate-700"
                                        >
                                            {eventLabel(route.eventType)}
                                        </td>
                                        <td data-label="等级" className="px-4 py-3">
                                            <span className={severityBadge(route.severity)}>
                                                {displayState(route.severity)}
                                            </span>
                                        </td>
                                        <td data-label="主责" data-mobile-wide className="px-4 py-3">
                                            <AdminSelect
                                                aria-label={
                                                    eventTypeDisplayLabel(route.eventType) + ' 主责部门'
                                                }
                                                value={owner}
                                                onChange={event =>
                                                    updateRouteOverride(route.eventType, {
                                                        owner: event.target.value,
                                                    })
                                                }
                                                className={compactInputClass}
                                            >
                                                {routing.departments.map(department => (
                                                    <option key={department.code} value={department.code}>
                                                        {department.nameZh}
                                                    </option>
                                                ))}
                                            </AdminSelect>
                                        </td>
                                        <td data-label="协作" data-mobile-wide className="px-4 py-3">
                                            <AdminSelect
                                                multiple
                                                aria-label={
                                                    eventTypeDisplayLabel(route.eventType) + ' 协作部门'
                                                }
                                                value={collaborators}
                                                onChange={event =>
                                                    updateRouteOverride(route.eventType, {
                                                        collaborators: Array.from(
                                                            event.currentTarget.selectedOptions,
                                                            option => option.value,
                                                        ),
                                                    })
                                                }
                                                className={compactInputClass + ' min-h-16'}
                                            >
                                                {routing.departments
                                                    .filter(department => department.code !== owner)
                                                    .map(department => (
                                                        <option key={department.code} value={department.code}>
                                                            {department.nameZh}
                                                        </option>
                                                    ))}
                                            </AdminSelect>
                                        </td>
                                        <td data-label="升级" data-mobile-wide className="px-4 py-3">
                                            <AdminSelect
                                                aria-label={
                                                    eventTypeDisplayLabel(route.eventType) + ' 升级部门'
                                                }
                                                value={escalation ?? ''}
                                                disabled={route.severity === 'P0'}
                                                onChange={event =>
                                                    updateRouteOverride(route.eventType, {
                                                        escalation: event.target.value || null,
                                                    })
                                                }
                                                className={compactInputClass}
                                            >
                                                <option value="">不升级</option>
                                                {routing.departments.map(department => (
                                                    <option key={department.code} value={department.code}>
                                                        {department.nameZh}
                                                    </option>
                                                ))}
                                            </AdminSelect>
                                        </td>
                                        <td data-label="需处理" className="px-4 py-3">
                                            <AdminInput
                                                aria-label={
                                                    eventTypeDisplayLabel(route.eventType) + ' 需要处理'
                                                }
                                                type="checkbox"
                                                checked={actionRequired}
                                                disabled={route.severity === 'P0' || route.severity === 'P1'}
                                                onChange={event =>
                                                    updateRouteOverride(route.eventType, {
                                                        actionRequired: event.target.checked,
                                                    })
                                                }
                                            />
                                        </td>
                                        <td data-label="处理时限" data-mobile-wide className="px-4 py-3">
                                            <AdminInput
                                                aria-label={
                                                    eventTypeDisplayLabel(route.eventType) +
                                                    ' 处理时限（分钟）'
                                                }
                                                type="number"
                                                min={route.severity === 'P0' ? 0 : 1}
                                                disabled={route.severity === 'P0'}
                                                value={slaMinutes ?? ''}
                                                onChange={event =>
                                                    updateRouteOverride(route.eventType, {
                                                        slaMinutes: event.target.value
                                                            ? Number(event.target.value)
                                                            : null,
                                                    })
                                                }
                                                className={compactInputClass + ' w-20'}
                                            />
                                        </td>
                                        <td
                                            data-label="处理建议"
                                            data-mobile-wide
                                            className="max-w-80 px-4 py-3 text-slate-600"
                                        >
                                            <span className="block truncate" title={route.actionHint}>
                                                {route.actionHint}
                                            </span>
                                        </td>
                                        <td
                                            data-label="路由操作"
                                            className="sticky right-0 bg-white px-4 py-3 text-right"
                                        >
                                            <AdminButton
                                                type="button"
                                                onClick={() => resetRouteOverride(route.eventType)}
                                                disabled={!override}
                                                className={secondaryButton}
                                            >
                                                恢复默认
                                            </AdminButton>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section
                hidden={notificationSection !== 'incidents'}
                style={notificationSection === 'incidents' ? undefined : { display: 'none' }}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
                <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="rounded-lg bg-rose-50 p-2 text-rose-700">
                            <ShieldAlert className="h-5 w-5" />
                        </span>
                        <div>
                            <h2 className="admin-section-title-line text-sm font-bold text-slate-900">
                                事故响应与闭环
                                <span className="text-xs font-normal text-slate-500">确认、验证与整改</span>
                                <FeatureHelpButton
                                    topic="settings.telegram"
                                    title="事故响应与闭环"
                                    description={
                                        '即使 Telegram 停用，事故仍会留存。P0/P1 需经负责人确认、恢复验证、复盘和整改后才能闭环。'
                                    }
                                />
                            </h2>
                        </div>
                    </div>
                    <span className={badgeBlue}>共 {incidents.totalItems} 起</span>
                </div>
                <div
                    className="admin-comparison-scroll"
                    role="region"
                    tabIndex={0}
                    aria-label="事故表，可横向滚动"
                >
                    <table className="admin-compact-table w-full min-w-[1450px] table-fixed text-left text-xs">
                        <colgroup>
                            <col className="w-[90px]" />
                            <col className="w-[130px]" />
                            <col className="w-[120px]" />
                            <col className="w-[280px]" />
                            <col className="w-[200px]" />
                            <col className="w-[80px]" />
                            <col className="w-[160px]" />
                            <col className="w-[280px]" />
                            <col className="w-[110px]" />
                        </colgroup>
                        <thead className={tableHeadClass}>
                            <tr>
                                {[
                                    '严重程度',
                                    '事故状态',
                                    '主责部门',
                                    '标题',
                                    '事件类型',
                                    '发生次数',
                                    '最近发生',
                                    '根因',
                                ].map(label => (
                                    <th key={label} scope="col">
                                        {label}
                                    </th>
                                ))}
                                <th scope="col" className="sticky right-0 bg-slate-50 text-right">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {incidents.items.map(incident => (
                                <tr key={incident.id}>
                                    <td data-label="严重程度">
                                        <span className={severityBadge(incident.severity)}>
                                            {severityDisplayLabel(incident.severity)}
                                        </span>
                                    </td>
                                    <td data-label="事故状态">
                                        <span className={incidentStatusBadge(incident.incidentStatus)}>
                                            {incidentStatusLabel(incident.incidentStatus)}
                                        </span>
                                    </td>
                                    <td data-label="主责部门">
                                        {departmentDisplayLabel(incident.ownerDepartmentCode)}
                                    </td>
                                    <td data-label="标题">
                                        <span
                                            className="block truncate font-semibold text-slate-800"
                                            title={incident.title}
                                        >
                                            {incident.title}
                                        </span>
                                    </td>
                                    <td data-label="事件类型">
                                        <span
                                            className="block truncate"
                                            title={eventTypeDisplayLabel(incident.eventType)}
                                        >
                                            {eventTypeDisplayLabel(incident.eventType)}
                                        </span>
                                    </td>
                                    <td data-label="发生次数">{incident.occurrenceCount}</td>
                                    <td data-label="最近发生" className="whitespace-nowrap">
                                        {formatDateTime(incident.lastOccurredAt)}
                                    </td>
                                    <td data-label="根因">
                                        <span className="block truncate" title={incident.rootCause || '—'}>
                                            {incident.rootCause || '—'}
                                        </span>
                                    </td>
                                    <td data-label="操作" className="sticky right-0 bg-white text-right">
                                        {incident.incidentStatus === 'OPEN' && (
                                            <AdminButton
                                                type="button"
                                                className={primaryButton}
                                                disabled={busy}
                                                onClick={() =>
                                                    openIncidentNoteAction(
                                                        'ACKNOWLEDGE',
                                                        incident.id,
                                                        '负责人确认事故',
                                                    )
                                                }
                                            >
                                                确认接手
                                            </AdminButton>
                                        )}
                                        {incident.incidentStatus === 'RECOVERY_PENDING' && (
                                            <AdminButton
                                                type="button"
                                                className={primaryButton}
                                                disabled={busy}
                                                onClick={() =>
                                                    openIncidentNoteAction(
                                                        'RECOVERY',
                                                        incident.id,
                                                        '确认恢复验证',
                                                    )
                                                }
                                            >
                                                验证恢复
                                            </AdminButton>
                                        )}
                                        {incident.incidentStatus === 'REVIEW_PENDING' && (
                                            <AdminButton
                                                type="button"
                                                className={primaryButton}
                                                disabled={busy}
                                                onClick={() =>
                                                    openIncidentReview(
                                                        incident.id,
                                                        incident.ownerDepartmentCode,
                                                    )
                                                }
                                            >
                                                提交复盘
                                            </AdminButton>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!incidents.items.length && <p className="p-5 text-xs text-slate-400">暂无事故记录</p>}
                {incidents.items.some(incident => incident.actions.length > 0) && (
                    <details className="border-t border-slate-100 p-4">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                            整改任务 ·{' '}
                            {incidents.items.reduce((total, incident) => total + incident.actions.length, 0)}{' '}
                            项
                        </summary>
                        {incidents.items
                            .filter(incident => incident.actions.length > 0)
                            .map(incident => (
                                <section key={incident.id} className="mt-3">
                                    <div className="admin-section-title-line mb-2">
                                        <h3 className="text-xs font-semibold text-slate-800">
                                            {incident.title}
                                        </h3>
                                        <span className="text-xs text-slate-500">整改任务</span>
                                    </div>
                                    <div
                                        className="admin-comparison-scroll"
                                        role="region"
                                        tabIndex={0}
                                        aria-label={`${incident.title}整改任务，可横向滚动`}
                                    >
                                        <table className="admin-compact-table w-full min-w-[860px] table-fixed text-left text-xs">
                                            <thead className={tableHeadClass}>
                                                <tr>
                                                    {['整改标题', '责任部门', '截止时间', '状态'].map(
                                                        label => (
                                                            <th key={label} scope="col">
                                                                {label}
                                                            </th>
                                                        ),
                                                    )}
                                                    <th
                                                        scope="col"
                                                        className="sticky right-0 w-28 bg-slate-50 text-right"
                                                    >
                                                        操作
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {incident.actions.map(action => (
                                                    <tr key={action.id}>
                                                        <td data-label="整改标题">
                                                            <span
                                                                className="block truncate"
                                                                title={action.title}
                                                            >
                                                                {action.title}
                                                            </span>
                                                        </td>
                                                        <td data-label="责任部门">
                                                            {departmentDisplayLabel(
                                                                action.ownerDepartmentCode,
                                                            )}
                                                        </td>
                                                        <td data-label="截止时间">
                                                            {formatDateTime(action.dueAt)}
                                                        </td>
                                                        <td data-label="状态">
                                                            {systemStatusDisplayLabel(action.status)}
                                                        </td>
                                                        <td
                                                            data-label="操作"
                                                            className="sticky right-0 bg-white text-right"
                                                        >
                                                            {action.status === 'OPEN' && (
                                                                <AdminButton
                                                                    type="button"
                                                                    className={secondaryButton}
                                                                    disabled={busy}
                                                                    onClick={() =>
                                                                        openIncidentNoteAction(
                                                                            'ACTION',
                                                                            action.id,
                                                                            '完成整改任务',
                                                                        )
                                                                    }
                                                                >
                                                                    完成整改
                                                                </AdminButton>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            ))}
                    </details>
                )}
            </section>

            <section
                hidden={notificationSection !== 'deliveries'}
                style={notificationSection === 'deliveries' ? undefined : { display: 'none' }}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
                <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="admin-section-title-line text-sm font-bold text-slate-900">
                            最近发送记录
                            <span className="text-xs font-normal text-slate-500">最近 25 条通知</span>
                            <FeatureHelpButton topic="settings.telegram" title="最近发送记录" />
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            共 {deliveries.totalItems} 条，显示最近 25 条
                        </p>
                    </div>
                    <AdminSelect
                        value={statusFilter}
                        onChange={event => setStatusFilter(event.target.value)}
                        className={inputClass + ' w-40'}
                    >
                        <option value="">全部状态</option>
                        {['PENDING', 'CLAIMED', 'RETRY', 'SENT', 'DEAD', 'SKIPPED'].map(value => (
                            <option key={value} value={value}>
                                {displayState(value)}
                            </option>
                        ))}
                    </AdminSelect>
                </div>
                <div className="admin-comparison-scroll">
                    <table className="admin-compact-table w-full min-w-[1540px] border-collapse text-left text-xs">
                        <thead>
                            <tr className={tableHeadClass}>
                                <th className="px-4 py-3">时间</th>
                                <th scope="col" className="px-4 py-3">
                                    通知标题
                                </th>
                                <th scope="col" className="px-4 py-3">
                                    事件
                                </th>
                                <th className="px-4 py-3">等级</th>
                                <th scope="col" className="px-4 py-3">
                                    主责
                                </th>
                                <th className="px-4 py-3">状态</th>
                                <th scope="col" className="px-4 py-3">
                                    已尝试次数
                                </th>
                                <th scope="col" className="px-4 py-3">
                                    最多尝试次数
                                </th>
                                <th className="px-4 py-3">错误</th>
                                <th
                                    scope="col"
                                    className="sticky right-0 w-24 bg-slate-50 px-4 py-3 text-right"
                                >
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {deliveries.items.map(delivery => (
                                <tr key={delivery.id} className="hover:bg-slate-50">
                                    <td
                                        data-label="时间"
                                        className="whitespace-nowrap px-4 py-3 text-[10px] text-slate-500"
                                    >
                                        {formatDateTime(delivery.createdAt)}
                                    </td>
                                    <td data-label="通知标题" className="max-w-80 px-4 py-3">
                                        <span
                                            className="block truncate font-semibold text-slate-800"
                                            title={delivery.title}
                                        >
                                            {delivery.title}
                                        </span>
                                    </td>
                                    <td data-label="事件" className="max-w-56 px-4 py-3">
                                        <span
                                            className="block truncate text-slate-500"
                                            title={eventLabel(delivery.eventType)}
                                        >
                                            {eventLabel(delivery.eventType)}
                                        </span>
                                    </td>
                                    <td data-label="等级" className="px-4 py-3">
                                        <span className={severityBadge(delivery.severity)}>
                                            {displayState(delivery.severity)}
                                        </span>
                                    </td>
                                    <td data-label="主责" className="px-4 py-3 font-bold text-slate-700">
                                        {routing.departments.find(
                                            department => department.code === delivery.ownerDepartmentCode,
                                        )?.nameZh ?? '运营调度中心'}
                                    </td>
                                    <td data-label="状态" className="px-4 py-3">
                                        <span className={statusBadge(delivery.deliveryStatus)}>
                                            {displayState(delivery.deliveryStatus)}
                                        </span>
                                    </td>
                                    <td data-label="已尝试次数" className="px-4 py-3 text-slate-600">
                                        {delivery.attempts}
                                    </td>
                                    <td data-label="最多尝试次数" className="px-4 py-3 text-slate-600">
                                        {delivery.maxAttempts}
                                    </td>
                                    <td
                                        data-label="错误"
                                        data-mobile-wide
                                        className="max-w-72 px-4 py-3 text-[10px] text-rose-700"
                                    >
                                        <span
                                            className="block truncate"
                                            title={chineseError(delivery.lastError)}
                                        >
                                            {chineseError(delivery.lastError)}
                                        </span>
                                    </td>
                                    <td
                                        data-label="操作"
                                        className="sticky right-0 bg-white px-4 py-3 text-right"
                                    >
                                        {['DEAD', 'RETRY'].includes(delivery.deliveryStatus) && (
                                            <AdminButton
                                                type="button"
                                                onClick={() => void retry(delivery.id)}
                                                disabled={busy}
                                                className={secondaryButton}
                                            >
                                                <RotateCcw className="h-3.5 w-3.5" />
                                                重试
                                            </AdminButton>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!deliveries.items.length && <p className="p-5 text-xs text-slate-400">暂无通知记录</p>}
            </section>

            {incidentDialog && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
                    onClick={() => !busy && setIncidentDialog(null)}
                >
                    <AccessibleDialogSurface
                        accessibleName={incidentDialog.label}
                        onRequestClose={() => !busy && setIncidentDialog(null)}
                        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <form
                            onSubmit={event => {
                                event.preventDefault();
                                void submitIncidentDialog();
                            }}
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                                <div>
                                    <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                                        <ShieldAlert className="h-5 w-5 text-rose-600" />
                                        {incidentDialog.label}
                                    </h2>
                                    <p className="mt-1 text-xs text-slate-500">
                                        提交后将写入不可编辑的事故证据链，请使用可核验的业务事实。
                                    </p>
                                </div>
                                <AdminButton
                                    type="button"
                                    onClick={() => setIncidentDialog(null)}
                                    disabled={busy}
                                    aria-label="关闭事故操作窗口"
                                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                                >
                                    <X className="h-4 w-4" />
                                </AdminButton>
                            </div>
                            <div className="space-y-4 p-5">
                                {incidentDialog.kind === 'REVIEW' ? (
                                    <>
                                        <Field label="根因说明" hint="20–2000 字">
                                            <AdminTextArea
                                                value={incidentDialog.rootCause}
                                                onChange={event =>
                                                    setIncidentDialog({
                                                        ...incidentDialog,
                                                        rootCause: event.target.value,
                                                    })
                                                }
                                                rows={4}
                                                className={inputClass}
                                            />
                                        </Field>
                                        <Field label="影响范围与结果" hint="20–2000 字">
                                            <AdminTextArea
                                                value={incidentDialog.impactSummary}
                                                onChange={event =>
                                                    setIncidentDialog({
                                                        ...incidentDialog,
                                                        impactSummary: event.target.value,
                                                    })
                                                }
                                                rows={4}
                                                className={inputClass}
                                            />
                                        </Field>
                                        <Field label="首项整改任务" hint="5–500 字">
                                            <AdminInput
                                                value={incidentDialog.actionTitle}
                                                onChange={event =>
                                                    setIncidentDialog({
                                                        ...incidentDialog,
                                                        actionTitle: event.target.value,
                                                    })
                                                }
                                                className={inputClass}
                                            />
                                        </Field>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Field label="责任部门">
                                                <AdminSelect
                                                    value={incidentDialog.ownerDepartmentCode}
                                                    onChange={event =>
                                                        setIncidentDialog({
                                                            ...incidentDialog,
                                                            ownerDepartmentCode: event.target.value,
                                                        })
                                                    }
                                                    className={inputClass}
                                                >
                                                    {routing.departments.map(department => (
                                                        <option
                                                            key={department.nameZh}
                                                            value={department.nameZh}
                                                        >
                                                            {department.nameZh}
                                                        </option>
                                                    ))}
                                                </AdminSelect>
                                            </Field>
                                            <Field label="整改截止时间">
                                                <AdminInput
                                                    type="datetime-local"
                                                    value={incidentDialog.dueAt}
                                                    onChange={event =>
                                                        setIncidentDialog({
                                                            ...incidentDialog,
                                                            dueAt: event.target.value,
                                                        })
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                        </div>
                                    </>
                                ) : (
                                    <Field label="处理说明" hint="至少 10 字">
                                        <AdminTextArea
                                            value={incidentDialog.note}
                                            onChange={event =>
                                                setIncidentDialog({
                                                    ...incidentDialog,
                                                    note: event.target.value,
                                                })
                                            }
                                            rows={5}
                                            className={inputClass}
                                        />
                                    </Field>
                                )}
                            </div>
                            <div className="flex justify-end gap-2 border-t border-slate-100 p-5">
                                <AdminButton
                                    type="button"
                                    onClick={() => setIncidentDialog(null)}
                                    disabled={busy}
                                    className={secondaryButton}
                                >
                                    取消
                                </AdminButton>
                                <AdminButton
                                    type="submit"
                                    disabled={busy || !incidentDialogValid(incidentDialog)}
                                    className={primaryButton}
                                >
                                    {busy ? '正在保存…' : '确认并留存证据'}
                                </AdminButton>
                            </div>
                        </form>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function draftFromConfig(config: TelegramNotificationConfigRecord): Draft {
    return {
        enabled: config.enabled,
        chatId: config.chatId,
        adminBaseUrl: config.adminBaseUrl,
        timezone: config.timezone,
        minSeverity: config.minSeverity,
        sendResolved: config.sendResolved,
        p2Silent: config.p2Silent,
        p3Silent: config.p3Silent,
        notifyOrderEvents: config.notifyOrderEvents,
        notifyPaymentEvents: config.notifyPaymentEvents,
        notifyFulfillmentEvents: config.notifyFulfillmentEvents,
        notifyRefundEvents: config.notifyRefundEvents,
        notifyInventoryEvents: config.notifyInventoryEvents,
        notifyOnlineReports: config.notifyOnlineReports ?? true,
        notifyServiceReviews: config.notifyServiceReviews ?? true,
        notifyPromotionExpiry: config.notifyPromotionExpiry ?? true,
        notifyAiCredentials: config.notifyAiCredentials ?? true,
        notifySecurityEvents: config.notifySecurityEvents ?? true,
        inventoryLowThreshold: config.inventoryLowThreshold,
        p1EscalationMinutes: config.p1EscalationMinutes,
        p0RepeatMinutes: config.p0RepeatMinutes,
        p1RepeatMinutes: config.p1RepeatMinutes,
        departmentMentions: { ...config.departmentMentions },
        routeOverrides: config.routeOverrides.map(item => ({
            ...item,
            ...(item.collaborators ? { collaborators: [...item.collaborators] } : {}),
        })),
    };
}

function incidentStatusLabel(status: string): string {
    return getSystemLabel(
        status,
        {
            OPEN: '待确认',
            ACKNOWLEDGED: '处理中',
            RECOVERY_PENDING: '待恢复验证',
            REVIEW_PENDING: '待复盘',
            ACTION_PENDING: '整改中',
            CLOSED: '已闭环',
        },
        'zh',
        'status',
    );
}

function incidentStatusBadge(status: string): string {
    if (status === 'CLOSED') return badgeGreen;
    if (status === 'OPEN' || status === 'RECOVERY_PENDING') return badgeRose;
    if (status === 'REVIEW_PENDING' || status === 'ACTION_PENDING') return badgeAmber;
    return badgeBlue;
}

function incidentDialogValid(draft: IncidentDialogDraft): boolean {
    if (draft.kind !== 'REVIEW') return draft.note.trim().length >= 10;
    const dueAt = new Date(draft.dueAt).getTime();
    return (
        draft.rootCause.trim().length >= 20 &&
        draft.impactSummary.trim().length >= 20 &&
        draft.actionTitle.trim().length >= 5 &&
        Boolean(draft.ownerDepartmentCode) &&
        Number.isFinite(dueAt) &&
        dueAt > Date.now() + 60 * 60_000
    );
}

function Toggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">
            <span>{label}</span>
            <AdminInput
                type="checkbox"
                checked={checked}
                onChange={event => onChange(event.target.checked)}
            />
        </label>
    );
}

function NumberField({
    label,
    value,
    minimum,
    onChange,
}: {
    label: string;
    value: number;
    minimum: number;
    onChange: (value: number) => void;
}) {
    return (
        <Field label={label}>
            <AdminInput
                type="number"
                min={minimum}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
                className={inputClass}
            />
        </Field>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <AdminField label={label} description={hint} className="text-[10px] font-bold text-slate-600">
            {children}
        </AdminField>
    );
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
        <div className="min-w-0 border-b border-slate-200 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
            <p className={'mt-2 text-lg font-black ' + colors[tone]}>{value}</p>
            <p className="mt-1 truncate text-[10px] text-slate-500" title={detail}>
                {detail}
            </p>
        </div>
    );
}

function Message({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
    return (
        <div
            role="status"
            className={
                'flex items-center gap-2 rounded-lg border p-3 text-xs font-bold ' +
                (tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800')
            }
        >
            {tone === 'success' ? (
                <CheckCircle2 className="h-4 w-4" />
            ) : (
                <AlertTriangle className="h-4 w-4" />
            )}
            {children}
        </div>
    );
}

function LoadingState() {
    return (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
            <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
            正在加载 Telegram 通知中心
        </div>
    );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-rose-600" />
            <p className="mt-3 text-sm font-bold text-rose-900">加载失败</p>
            <p className="mt-1 text-xs text-rose-700">{message}</p>
            <AdminButton type="button" onClick={onRetry} className={secondaryButton + ' mt-4'}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试
            </AdminButton>
        </div>
    );
}

function sourceLabel(source: string) {
    return source === 'ENVIRONMENT' ? '环境变量' : source === 'DATABASE' ? '数据库' : '未配置';
}

function duration(seconds: number) {
    if (seconds < 60) return seconds + ' 秒';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟';
    return Math.floor(seconds / 3600) + ' 小时';
}

function severityBadge(value: string) {
    if (value === 'P0') return 'rounded bg-rose-100 px-2 py-1 text-[9px] font-black text-rose-700';
    if (value === 'P1') return 'rounded bg-amber-100 px-2 py-1 text-[9px] font-black text-amber-700';
    if (value === 'P2') return 'rounded bg-blue-100 px-2 py-1 text-[9px] font-black text-blue-700';
    return 'rounded bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600';
}

function statusBadge(value: string) {
    if (value === 'SENT') return badgeGreen;
    if (value === 'DEAD') return badgeRose;
    if (value === 'RETRY') return 'rounded bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-700';
    return badgeBlue;
}

const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500';
const compactInputClass =
    'rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400';
const primaryButton =
    'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
    'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const tableHeadClass =
    'border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500';
const badgeGreen = 'rounded bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700';
const badgeRose = 'rounded bg-rose-100 px-2 py-1 text-[9px] font-bold text-rose-700';
const badgeBlue = 'rounded bg-blue-100 px-2 py-1 text-[9px] font-bold text-blue-700';
const badgeAmber = 'rounded bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-700';

function displayState(value: string) {
    return (
        (
            {
                P0: '危急',
                P1: '重要',
                P2: '提醒',
                P3: '信息',
                PENDING: '等待发送',
                CLAIMED: '正在发送',
                RETRY: '等待重试',
                SENT: '已发送',
                DEAD: '发送失败待处理',
                SKIPPED: '已跳过',
            } as Record<string, string>
        )[value] ?? '其他状态'
    );
}
function chineseError(value: string | null) {
    return !value ? '—' : /\p{Script=Han}/u.test(value) ? value : '发送异常，请检查连接与发送记录';
}

function eventLabel(value: string): string {
    const labels: Record<string, string> = {
        'commerce.order.placed': '新订单',
        'commerce.payment.authorized': '支付已授权',
        'commerce.payment.settled': '支付成功',
        'commerce.payment.failed': '支付失败',
        'commerce.payment.declined': '支付被拒绝',
        'commerce.payment.proof_mismatch': '支付凭证不匹配',
        'commerce.payment.amount_mismatch': '支付金额异常',
        'commerce.payment.manual_review': '支付需人工审核',
        'commerce.payment.cancelled': '支付取消',
        'commerce.fulfillment.created': '开始订单交付',
        'commerce.fulfillment.shipped': '订单已发货',
        'commerce.fulfillment.delivered': '订单已送达',
        'commerce.fulfillment.cancelled': '交付取消',
        'commerce.fulfillment.auto_card_failed': '自动发卡失败',
        'commerce.fulfillment.manual_delivery_failed': '人工交付失败',
        'commerce.fulfillment.manual_delivery_overdue': '人工交付超时',
        'commerce.refund.pending': '退款待处理',
        'commerce.refund.settled': '退款成功',
        'commerce.refund.failed': '退款失败',
        'inventory.variant.low': '缺货与低库存',
        'inventory.variant.recovered': '库存恢复',
        'inventory.auto_card.empty': '自动发卡缺货',
        'system.notification.queue_lag': '重要通知积压',
        'system.notification.dead_letter': '通知发送失败待处理',
        'system.notification.test': '中文通知自检',
        'platform.online.hourly': '每小时在线汇报',
        'commerce.service_review.submitted': '客服评价',
        'commerce.service_review.negative': '客服低分评价',
        'commerce.promotion.expiring': '优惠活动到期提醒',
        'ai.access.unavailable': '人工智能调用凭证异常',
        'ai.service.unavailable': '人工智能服务无可用通道',
        'security.login.failures': '后台异常登录尝试',
        'security.admin.changed': '管理员与权限变更',
        'security.factor.changed': '后台二次验证变更',
        'security.api_key.changed': '后台接口凭证变更',
        'system.database.down': '数据库连接中断',
        'system.database.recovered': '数据库连接恢复',
        'system.monitor.unavailable': '部分巡检不可用',
        'system.store.unavailable': '店铺接口持续不可用',
        'system.certificate.invalid': '网站证书失效',
        'system.certificate.expiring': '网站证书到期提醒',
    };
    return labels[value] ?? '其他系统事件';
}

function configFieldLabel(value: string) {
    return (
        (
            {
                enabled: '通知总开关',
                chatId: '接收群编号',
                adminBaseUrl: '后台入口',
                timezone: '通知时区',
                minSeverity: '最低通知等级',
                sendResolved: '恢复通知',
                p2Silent: '提醒静默推送',
                p3Silent: '信息静默推送',
                notifyOrderEvents: '订单通知',
                notifyPaymentEvents: '支付通知',
                notifyFulfillmentEvents: '交付通知',
                notifyRefundEvents: '退款通知',
                notifyInventoryEvents: '库存通知',
                notifyOnlineReports: '在线汇报',
                notifyServiceReviews: '客服评价',
                notifyPromotionExpiry: '活动到期',
                notifyAiCredentials: '人工智能凭证告警',
                notifySecurityEvents: '安全告警',
                inventoryLowThreshold: '库存阈值',
                p0RepeatMinutes: '危急重复间隔',
                p1RepeatMinutes: '重要重复间隔',
                p1EscalationMinutes: '重要升级时限',
                departmentMentions: '部门提及对象',
                routeOverrides: '部门责任路由',
            } as Record<string, string>
        )[value] ?? '通知策略'
    );
}
