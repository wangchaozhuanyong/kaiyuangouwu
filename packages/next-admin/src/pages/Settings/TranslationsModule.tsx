import { useMutation } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    FlaskConical,
    Languages,
    LoaderCircle,
    Play,
    RefreshCw,
    Search,
    WandSparkles,
    X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSystemLabel } from '../../../../common/src/display-localization';
import { getAdminQueryScope } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { AdminOverlayPortal } from '../../components/AdminOverlayHost';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import {
    BACKFILL_CONTENT_TRANSLATIONS_MUTATION,
    CONFIRM_CONTENT_TRANSLATION_REVIEW_MUTATION,
    CONTENT_TRANSLATION_AUDIT_QUERY,
    CONTENT_TRANSLATION_REVIEW_QUERY,
    RETRY_CONTENT_TRANSLATIONS_MUTATION,
    TEST_CONTENT_TRANSLATION_MUTATION,
    type ContentTranslationAuditResult,
    type ContentTranslationBackfillResult,
    type ContentTranslationReviewRecord,
    type ContentTranslationStateRecord,
} from '../../graphql/plugins.graphql';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { usePageActivity } from '../../hooks/use-page-activity';
import { usePageSize } from '../../hooks/use-page-size';
import { getChannelDisplayName } from '../../utils/channel-display';
import { getTranslationStatusLabel } from '../../utils/status-labels';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from '../Catalog/LookupPager';
import { formatDateTime } from '../Sales/sales-utils';

const entityOptions = [
    ['ALL', '全部客户可见内容'],
    ['Product', '商品'],
    ['ProductVariant', 'SKU 变体'],
    ['ProductOptionGroup', '规格组'],
    ['ProductOption', '规格值'],
    ['Collection', '集合'],
    ['Facet', '筛选属性'],
    ['FacetValue', '属性值'],
    ['Promotion', '促销'],
    ['ShippingMethod', '配送方式'],
    ['PaymentMethod', '支付方式'],
    ['Country', '国家'],
    ['Province', '省份'],
    ['StoreProfile', '店铺档案'],
    ['SystemAnnouncement', '系统公告'],
    ['StorefrontContentBlock', '店铺内容区块'],
    ['StorefrontContentItem', '店铺内容子项'],
    ['AutoCardConfig', '卡密交付配置'],
    ['StorefrontReview', '评价商家回复'],
    ['AfterSalesRequest', '售后处理结果'],
    ['ReferralPosterTemplate', '邀请海报'],
    ['ImageGenerationConfig', '生图条款'],
    ['ImageModelConfig', '生图模型文案'],
] as const;

const backfillEntityOptions = entityOptions;

export function TranslationsModule() {
    return <TranslationAuditPage key={getAdminQueryScope()} />;
}

function TranslationAuditPage() {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('ALL');
    const [entityType, setEntityType] = useState('ALL');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setPage);
    const [backfillOpen, setBackfillOpen] = useState(false);
    const [testOpen, setTestOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [reviewId, setReviewId] = useState<string | null>(null);
    const active = usePageActivity();
    const activeRef = useRef(active);
    useLayoutEffect(() => {
        activeRef.current = active;
    }, [active]);
    const isCurrentScope = useCurrentTranslationScope();
    const query = useQuery<ContentTranslationAuditResult>(CONTENT_TRANSLATION_AUDIT_QUERY, {
        variables: {
            options: {
                skip: page * pageSize,
                take: pageSize,
                search: search.trim() || undefined,
                status: status === 'ALL' ? undefined : status,
                entityType: entityType === 'ALL' ? undefined : entityType,
            },
        },

        notifyOnNetworkStatusChange: true,
    });
    // Keep the search/filter controls mounted while a different page is loading.
    // The shared adapter retains data only for the same request identity. Apollo's
    // previousData may belong to another filter and must never be reused here.
    const result = query.data;
    const audit = result?.contentTranslationAudit;
    const states = audit?.states ?? [];
    const statusOptions = ['ALL', ...new Set((audit?.counts ?? []).map(item => item.status))];
    if (!statusOptions.includes(status)) statusOptions.push(status);
    const count = (value: string) => audit?.counts.find(item => item.status === value)?.count ?? 0;
    const lastPage = Math.max(0, Math.ceil((audit?.filteredTotal ?? 0) / pageSize) - 1);
    if (!query.loading && !query.error && query.data && page > lastPage) setPage(lastPage);
    const contentRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (contentRef.current) contentRef.current.scrollTop = 0;
    }, [page, pageSize, search, status, entityType]);

    const writeCompleted = async (message: string) => {
        if (!isCurrentScope()) return;
        setNotice(message);
        setActionError('');
        if (!activeRef.current) return; // The runtime refreshes an invalidated hidden page when it resumes.
        try {
            await query.refetch();
        } catch (error) {
            if (isCurrentScope())
                setActionError(`操作已完成，但最新记录读取失败，请刷新读取，勿重复提交。${errorText(error)}`);
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Languages className="h-5 w-5 text-blue-600" />
                            客户可见内容翻译
                            <FeatureHelpButton
                                topic="settings.translations"
                                title="客户可见内容翻译"
                                description={'审计中英文同步状态，补齐历史内容；静态界面词典不属于该后端插件'}
                            />
                        </h1>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <AdminButton
                            type="button"
                            onClick={() => setTestOpen(true)}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                        >
                            <FlaskConical className="h-3.5 w-3.5" />
                            测试翻译
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={() => setBackfillOpen(true)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            <WandSparkles className="h-3.5 w-3.5" />
                            补齐历史翻译
                        </AdminButton>
                        <AdminButton
                            refreshPage
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className="rounded-lg border border-slate-300 p-2 text-slate-600"
                            aria-label="刷新"
                        >
                            <RefreshCw
                                className={`h-4 w-4 ${query.loading && !query.data ? 'animate-spin' : ''}`}
                            />
                        </AdminButton>
                    </div>
                </div>
            </header>
            <main
                ref={contentRef}
                className="min-h-0 w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8"
            >
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
                <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            字段翻译审计
                            <FeatureHelpButton
                                topic="settings.translations"
                                title="字段翻译审计"
                                description={'每个客户可见字段都会保留一条审计记录；正常的自动翻译也会显示'}
                            />
                        </h2>

                        {audit && (
                            <p className="mt-1 text-xs text-slate-500" role="status">
                                当前店铺及全局内容共 {audit?.total ?? 0} 条，筛选匹配{' '}
                                {audit?.filteredTotal ?? 0} 条；搜索与分页覆盖全部历史记录。
                            </p>
                        )}
                    </div>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-3">
                        <div className="relative min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none h-3.5 w-3.5 text-slate-400" />
                            <SearchInput
                                value={search}
                                onValueChange={value => {
                                    setSearch(value);
                                    setPage(0);
                                }}
                                aria-label="搜索翻译审计记录"
                                placeholder="搜索实体、ID 或字段"
                                className={`${inputClass} pl-8`}
                            />
                        </div>
                        <AdminSelect
                            value={entityType}
                            onChange={event => {
                                setEntityType(event.target.value);
                                setPage(0);
                            }}
                            aria-label="筛选内容类型"
                            className={inputClass}
                        >
                            <option value="ALL">全部内容类型</option>
                            {entityOptions.slice(1).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </AdminSelect>
                        <AdminSelect
                            value={status}
                            onChange={event => {
                                setStatus(event.target.value);
                                setPage(0);
                            }}
                            aria-label="筛选翻译状态"
                            className={inputClass}
                        >
                            {statusOptions.map(value => (
                                <option key={value} value={value}>
                                    {value === 'ALL' ? '全部状态' : getTranslationStatusLabel(value)}
                                </option>
                            ))}
                        </AdminSelect>
                    </div>
                </section>
                {query.loading && !audit ? (
                    <LoadingState />
                ) : query.error && !query.data ? (
                    <ErrorState
                        message={toUserFacingError(query.error, '翻译任务数据读取失败')}
                        onRetry={() => void query.refetch()}
                    />
                ) : (
                    audit && (
                        <>
                            <section className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white xl:grid-cols-4">
                                <Metric
                                    label="翻译服务"
                                    value={audit.configured ? '已配置' : '未配置'}
                                    detail={`${audit.provider || '无可用服务商'} · 配置存在不代表连接已验证`}
                                    tone={audit.configured ? 'green' : 'amber'}
                                />
                                <Metric
                                    label="审计字段"
                                    value={`${audit.total} 项`}
                                    detail={`当前店铺及全局内容 · ${audit.counts.length} 种状态`}
                                />
                                <Metric
                                    label="待人工复核"
                                    value={`${count('STALE')} 项`}
                                    detail="人工英文不会被自动覆盖"
                                    tone={count('STALE') > 0 ? 'amber' : 'green'}
                                    onClick={() => {
                                        setStatus('STALE');
                                        setPage(0);
                                    }}
                                />
                                <Metric
                                    label="当前店铺"
                                    value={query.data ? getChannelDisplayName(query.data.activeChannel) : '—'}
                                    detail={
                                        (result?.activeChannel.availableLanguageCodes ?? []).join(' / ') ||
                                        '未返回语言'
                                    }
                                />
                            </section>
                            <section className="flex flex-wrap gap-2" aria-label="翻译处理状态">
                                {(['PENDING', 'TRANSLATING', 'NOTIFY_PENDING', 'FAILED'] as const).map(
                                    value => (
                                        <AdminButton
                                            key={value}
                                            type="button"
                                            aria-pressed={status === value}
                                            onClick={() => {
                                                setStatus(value);
                                                setPage(0);
                                            }}
                                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                                        >
                                            {getTranslationStatusLabel(value)} {count(value)} 项
                                        </AdminButton>
                                    ),
                                )}
                            </section>
                            {query.error && query.data && (
                                <div role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                                    更新失败，保留当前记录。{toUserFacingError(query.error)}
                                    <AdminButton
                                        type="button"
                                        className="ml-3 text-blue-600"
                                        onClick={() => void query.refetch()}
                                    >
                                        重试读取
                                    </AdminButton>
                                </div>
                            )}
                            {!audit.configured && (
                                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                                    <strong>自动翻译服务未配置。</strong>
                                    中文保存和历史入队仍可使用；配置恢复后可重试待处理翻译。API Key
                                    需要由部署环境变量提供，不在页面中明文保存。
                                </section>
                            )}
                            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <div
                                    className="overflow-x-auto"
                                    tabIndex={0}
                                    role="region"
                                    aria-label="翻译审计记录"
                                >
                                    <table className="admin-mobile-record-table w-full min-w-[1660px] border-collapse text-left text-xs">
                                        <thead className="sticky top-0 z-30 bg-slate-50">
                                            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                                                <th
                                                    scope="col"
                                                    className="sticky left-0 z-20 w-40 whitespace-nowrap bg-slate-50 px-3 py-3"
                                                >
                                                    内容类型
                                                </th>
                                                <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                                    内容 ID
                                                </th>
                                                <th scope="col" className="w-48 whitespace-nowrap px-3 py-3">
                                                    字段
                                                </th>
                                                <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                                    源语言
                                                </th>
                                                <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                                    目标语言
                                                </th>
                                                <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                                    状态
                                                </th>
                                                <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                                    来源
                                                </th>
                                                <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                                    人工锁定
                                                </th>
                                                <th scope="col" className="w-72 whitespace-nowrap px-3 py-3">
                                                    错误
                                                </th>
                                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                    更新时间
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="sticky right-0 z-20 w-28 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3"
                                                >
                                                    操作
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {states.map(item => (
                                                <AuditRow key={item.id} item={item} onReview={setReviewId} />
                                            ))}
                                            {query.loading && !query.data && (
                                                <tr>
                                                    <td
                                                        colSpan={11}
                                                        className="px-4 py-8 text-center text-slate-500"
                                                        role="status"
                                                    >
                                                        正在读取翻译记录…
                                                    </td>
                                                </tr>
                                            )}
                                            {!query.loading && !states.length && (
                                                <tr>
                                                    <td
                                                        colSpan={11}
                                                        className="p-12 text-center text-xs text-slate-400"
                                                    >
                                                        当前条件下没有审计记录
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="border-t border-slate-100 px-4 py-3">
                                    <LookupPager
                                        page={page}
                                        pageSize={pageSize}
                                        totalItems={audit.filteredTotal}
                                        onPageChange={setPage}
                                        onPageSizeChange={setPageSize}
                                        loading={query.loading}
                                    />
                                </div>
                            </section>
                        </>
                    )
                )}
            </main>
            {backfillOpen && (
                <BackfillDialog
                    configured={Boolean(audit?.configured)}
                    onClose={() => setBackfillOpen(false)}
                    onCompleted={writeCompleted}
                    onError={message => {
                        setActionError(message);
                        setNotice('');
                    }}
                />
            )}
            {reviewId && (
                <TranslationReviewDialog
                    key={reviewId}
                    id={reviewId}
                    onClose={() => setReviewId(null)}
                    onCompleted={writeCompleted}
                />
            )}
            {testOpen && (
                <TranslationTestDialog
                    configured={Boolean(audit?.configured)}
                    provider={audit?.provider ?? ''}
                    onClose={() => setTestOpen(false)}
                    onError={message => {
                        setActionError(message);
                        setNotice('');
                    }}
                />
            )}
        </div>
    );
}

function AuditRow({
    item,
    onReview,
}: {
    item: ContentTranslationStateRecord;
    onReview: (id: string) => void;
}) {
    const [retry, retryState] = useMutation(RETRY_CONTENT_TRANSLATIONS_MUTATION);
    const retryLock = useRef(false);
    return (
        <tr className="group h-[52px] hover:bg-slate-50">
            <td
                data-label="内容类型"
                className="sticky left-0 z-10 h-[52px] max-w-40 bg-white px-3 py-0 font-bold text-slate-800 group-hover:bg-slate-50"
            >
                <span className="block truncate" title={entityLabel(item.entityType)}>
                    {entityLabel(item.entityType)}
                </span>
            </td>
            <td data-label="内容 ID" className="h-[52px] max-w-56 px-3 py-0">
                <span className="block truncate font-mono text-[9px] text-slate-400" title={item.entityId}>
                    {item.entityId}
                </span>
            </td>
            <td
                data-label="字段"
                className="h-[52px] max-w-48 px-3 py-0 font-mono text-[10px] text-slate-600"
            >
                <span className="block truncate" title={item.fieldPath}>
                    {item.fieldPath}
                </span>
            </td>
            <td
                data-label="源语言"
                className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500"
            >
                {item.sourceLanguageCode}
            </td>
            <td
                data-label="目标语言"
                className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500"
            >
                {item.targetLanguageCode}
            </td>
            <td data-label="状态" className="h-[52px] whitespace-nowrap px-3 py-0">
                <StatusBadge status={item.status} />
            </td>
            <td data-label="来源" className="h-[52px] whitespace-nowrap px-3 py-0 text-[10px] text-slate-500">
                {originLabel(item.origin)}
            </td>
            <td data-label="人工锁定" className="h-[52px] whitespace-nowrap px-3 py-0">
                {item.locked ? (
                    <span className="font-bold text-amber-700">已锁定</span>
                ) : (
                    <span className="text-slate-400">未锁定</span>
                )}
            </td>
            <td data-label="错误" data-mobile-wide className="h-[52px] max-w-72 px-3 py-0">
                {item.error ? (
                    <span className="block truncate text-[10px] text-rose-600" title={item.error}>
                        {item.error}
                    </span>
                ) : (
                    <span className="text-[10px] text-slate-400">无</span>
                )}
            </td>
            <td
                data-label="更新时间"
                className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-400"
            >
                {formatDateTime(item.updatedAt)}
                <div title={item.lastErrorCode ?? undefined}>重试 {item.attempts} 次</div>
                {item.nextAttemptAt && <div>下次：{formatDateTime(item.nextAttemptAt)}</div>}
            </td>
            <td
                data-label="操作"
                className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 group-hover:bg-slate-50"
            >
                {!item.locked && ['PENDING', 'FAILED', 'NOTIFY_PENDING'].includes(item.status) && (
                    <AdminButton
                        type="button"
                        disabled={retryState.loading}
                        className="mr-3 text-blue-600 disabled:opacity-50"
                        onClick={() => {
                            if (retryState.loading || retryLock.current) return;
                            retryLock.current = true;
                            void retry({ variables: { ids: [item.id] } })
                                .catch(() => undefined)
                                .finally(() => {
                                    retryLock.current = false;
                                });
                        }}
                    >
                        {retryState.loading ? '排队中' : '重试'}
                    </AdminButton>
                )}
                {retryState.error && (
                    <span role="alert" className="mr-2 text-rose-600">
                        {toUserFacingError(retryState.error)}
                    </span>
                )}
                <AdminButton
                    type="button"
                    onClick={() => onReview(item.id)}
                    className="whitespace-nowrap text-[10px] font-bold text-blue-600 hover:text-blue-700"
                >
                    {item.status === 'STALE' ? '查看／复核' : '查看内容'}
                </AdminButton>
            </td>
        </tr>
    );
}

function TranslationReviewDialog({
    id,
    onClose,
    onCompleted,
}: {
    id: string;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
}) {
    const query = useQuery<{ contentTranslationReview: ContentTranslationReviewRecord | null }>(
        CONTENT_TRANSLATION_REVIEW_QUERY,
        { variables: { id } },
    );
    const review = query.data?.contentTranslationReview;
    const [confirm, state] = useMutation<{
        confirmCustomerContentTranslationReview: ContentTranslationStateRecord;
    }>(CONFIRM_CONTENT_TRANSLATION_REVIEW_MUTATION);
    const [error, setError] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const actionLock = useRef(false);
    const isCurrentScope = useCurrentTranslationScope();
    const run = async () => {
        if (!review?.canConfirm || confirmed || state.loading || actionLock.current || !isCurrentScope())
            return;
        actionLock.current = true;
        setError('');
        try {
            const response = await confirm({
                variables: {
                    input: {
                        id: review.state.id,
                        revision: review.state.revision,
                        sourceHash: review.sourceHash,
                        translatedHash: review.translatedHash,
                    },
                },
            });
            if (!isCurrentScope()) return;
            const saved = response.data?.confirmCustomerContentTranslationReview;
            if (!saved?.locked || saved.status !== 'MANUAL_LOCKED')
                throw new Error('复核未返回受保护的人工译文状态');
            setConfirmed(true);
            await onCompleted('已确认英文复核，继续保留人工锁定。');
        } catch (error) {
            if (isCurrentScope()) setError(errorText(error));
        } finally {
            actionLock.current = false;
        }
    };
    return (
        <Modal
            title="客户可见内容复核"
            description="对照当前中文与英文；修改文字使用原内容编辑器。确认不会解除人工锁定。"
            onClose={() => {
                if (!state.loading && !actionLock.current) onClose();
            }}
            actions={
                <div className="flex flex-wrap justify-end gap-2">
                    <AdminButton
                        type="button"
                        onClick={onClose}
                        disabled={state.loading}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                    >
                        关闭
                    </AdminButton>
                    {review?.editPath && !state.loading && (
                        <Link
                            to={review.editPath}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                            onClick={onClose}
                        >
                            去原页面编辑
                        </Link>
                    )}
                    {review?.canConfirm && !confirmed && (
                        <AdminButton
                            type="button"
                            onClick={() => void run()}
                            disabled={
                                state.loading || query.loading || Boolean(query.error) || Boolean(error)
                            }
                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            {state.loading ? '正在确认…' : '确认已复核，保留锁定'}
                        </AdminButton>
                    )}
                </div>
            }
        >
            {query.loading && !review ? (
                <p role="status" className="text-sm text-slate-500">
                    正在读取当前内容…
                </p>
            ) : null}
            {query.error && (
                <div role="alert" className="mb-3 text-xs text-rose-700">
                    {toUserFacingError(query.error, '内容读取失败')}
                    <AdminButton className="ml-3 text-blue-600" onClick={() => void query.refetch()}>
                        重试读取
                    </AdminButton>
                </div>
            )}
            {!query.loading && !query.error && !review && (
                <p className="text-sm text-slate-500">当前内容不存在或不属于当前店铺。</p>
            )}
            {review && (
                <>
                    <p className="mb-3 text-xs text-slate-500">
                        {entityLabel(review.state.entityType)} · {review.state.entityId} ·{' '}
                        {review.state.fieldPath}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="当前中文源内容">
                            <AdminTextArea
                                readOnly
                                rows={10}
                                value={review.sourceText}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="当前英文内容">
                            <AdminTextArea
                                readOnly
                                rows={10}
                                value={review.targetText}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                    {review.format === 'HTML' && (
                        <p className="mt-2 text-xs text-slate-500">HTML 以原文显示，不执行内容中的代码。</p>
                    )}
                    {!review.canConfirm && !confirmed && (
                        <p className="mt-3 text-xs text-amber-700">
                            {review.reason || '当前状态无需人工确认，或尚无可确认的人工英文。'}
                        </p>
                    )}
                </>
            )}
            {error && (
                <div role="alert" className="mt-3 text-xs text-rose-700">
                    {error}
                    <AdminButton
                        className="ml-3 text-blue-600"
                        disabled={state.loading}
                        onClick={() => {
                            setError('');
                            void query.refetch();
                        }}
                    >
                        重新读取内容
                    </AdminButton>
                </div>
            )}
            {confirmed && (
                <p role="status" className="mt-3 text-xs text-emerald-700">
                    复核已确认，人工锁定已保留。
                </p>
            )}
        </Modal>
    );
}

function BackfillDialog({
    configured,
    onClose,
    onCompleted,
    onError,
}: {
    configured: boolean;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [entityType, setEntityType] = useState('ALL');
    const [offset, setOffset] = useState(0);
    const [result, setResult] = useState<ContentTranslationBackfillResult | null>(null);
    const [totals, setTotals] = useState({ scanned: 0, processed: 0, queued: 0, skipped: 0, failed: 0 });
    const [error, setError] = useState('');
    const actionLock = useRef(false);
    const isCurrentScope = useCurrentTranslationScope();
    const [backfill, state] = useMutation<{
        backfillCustomerContentTranslations: ContentTranslationBackfillResult;
    }>(BACKFILL_CONTENT_TRANSLATIONS_MUTATION);
    const run = async () => {
        if (state.loading || actionLock.current || !isCurrentScope()) return;
        actionLock.current = true;
        setError('');
        try {
            const response = await backfill({
                variables: { entityType: entityType === 'ALL' ? null : entityType, limit: 100, offset },
            });
            const next = response.data?.backfillCustomerContentTranslations;
            if (!isCurrentScope()) return;
            if (!next) throw new Error('后端未返回补齐结果');
            if (next.hasMore && next.nextOffset <= offset)
                throw new Error('扫描未取得进展，已停止继续。请刷新记录后核对范围，不要反复提交同一批。');
            const cumulative = {
                scanned: totals.scanned + next.scanned,
                processed: totals.processed + next.processed,
                queued: totals.queued + next.queued,
                skipped: totals.skipped + next.skipped,
                failed: totals.failed + next.failed,
            };
            setResult(next);
            setTotals(cumulative);
            setOffset(next.nextOffset);
            if (!next.hasMore)
                await onCompleted(
                    `${next.errors.length ? '扫描已停止，存在需处理的错误' : '扫描完成'}：累计扫描 ${cumulative.scanned} 项，已排队 ${cumulative.queued} 项，已就绪 ${cumulative.processed} 项，跳过 ${cumulative.skipped} 项，失败 ${cumulative.failed} 项。扫描结束不代表译文完成，请查看后台处理状态。`,
                );
        } catch (error) {
            if (isCurrentScope()) {
                setError(errorText(error));
                onError(errorText(error));
            }
        } finally {
            actionLock.current = false;
        }
    };
    return (
        <Modal
            title="补齐历史客户可见内容"
            description="每批最多扫描 100 项，人工编辑并锁定的英文不会被覆盖"
            onClose={() => {
                if (!state.loading && !actionLock.current) onClose();
            }}
            actions={
                <div className="flex flex-wrap justify-end gap-2">
                    <AdminButton
                        type="button"
                        onClick={onClose}
                        disabled={state.loading}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                    >
                        {result && !result.hasMore ? '关闭' : '取消'}
                    </AdminButton>
                    {(!result || result.hasMore) && (
                        <AdminButton
                            type="button"
                            onClick={() => void run()}
                            disabled={state.loading || Boolean(error)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            {state.loading ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Play className="h-3.5 w-3.5" />
                            )}
                            {result ? '继续下一批' : '开始第一批'}
                        </AdminButton>
                    )}
                </div>
            }
        >
            <Field label="内容类型">
                <AdminSelect
                    value={entityType}
                    onChange={event => {
                        setEntityType(event.target.value);
                        setOffset(0);
                        setResult(null);
                        setTotals({ scanned: 0, processed: 0, queued: 0, skipped: 0, failed: 0 });
                        setError('');
                    }}
                    disabled={state.loading || offset > 0}
                    className={inputClass}
                >
                    {backfillEntityOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </AdminSelect>
            </Field>
            {!configured && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    翻译服务未配置，仍可登记待译内容；配置恢复后再重试。
                </p>
            )}
            {error && (
                <p role="alert" className="mt-3 text-xs text-rose-700">
                    {error}
                </p>
            )}
            {result && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                        <ResultMetric label="总量" value={result.total} />
                        <ResultMetric label="本批扫描" value={result.scanned} />
                        <ResultMetric label="本批就绪" value={result.processed} />
                        <ResultMetric label="本批排队" value={result.queued} />
                        <ResultMetric label="本批跳过" value={result.skipped} />
                        <ResultMetric label="本批失败" value={result.failed} />
                    </div>
                    <p className="mt-3 leading-5" role="status">
                        累计扫描 {totals.scanned} 项；就绪 {totals.processed} 项；排队 {totals.queued} 项；
                        跳过 {totals.skipped} 项；失败 {totals.failed} 项。
                        {!result.hasMore &&
                            (result.errors.length
                                ? ' 扫描已停止，请核对错误。'
                                : ' 扫描完成，后台翻译可能仍在进行。')}
                    </p>
                    {result.skippedRecords.length > 0 && (
                        <div className="mt-3 max-h-32 overflow-y-auto rounded bg-amber-50 p-2 text-[10px] text-amber-800">
                            {result.skippedRecords.map((warning, index) => (
                                <div key={index}>{warning}</div>
                            ))}
                        </div>
                    )}
                    {result.errors.length > 0 && (
                        <div className="mt-3 max-h-32 overflow-y-auto rounded bg-rose-50 p-2 text-[10px] text-rose-700">
                            {result.errors.map((error, index) => (
                                <div key={index}>{error}</div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}

function TranslationTestDialog({
    configured,
    provider,
    onClose,
    onError,
}: {
    configured: boolean;
    provider: string;
    onClose: () => void;
    onError: (message: string) => void;
}) {
    const [source, setSource] = useState('');
    const [format, setFormat] = useState<'TEXT' | 'HTML'>('TEXT');
    const [translated, setTranslated] = useState('');
    const [error, setError] = useState('');
    const actionLock = useRef(false);
    const isCurrentScope = useCurrentTranslationScope();
    const [test, state] = useMutation<{
        translateCustomerContent: {
            configured: boolean;
            provider: string;
            translations: Array<{ key: string; text: string }>;
        };
    }>(TEST_CONTENT_TRANSLATION_MUTATION);
    const run = async () => {
        if (!configured || !source.trim() || state.loading || actionLock.current || !isCurrentScope()) return;
        actionLock.current = true;
        setError('');
        try {
            const response = await test({
                variables: { segments: [{ key: 'preview', text: source.trim(), format }] },
            });
            const result = response.data?.translateCustomerContent;
            if (!isCurrentScope()) return;
            if (!result?.configured) throw new Error('翻译服务未配置');
            setTranslated(result.translations.find(item => item.key === 'preview')?.text ?? '');
        } catch (error) {
            if (isCurrentScope()) {
                setError(errorText(error));
                onError(errorText(error));
            }
        } finally {
            actionLock.current = false;
        }
    };
    return (
        <Modal
            title="翻译服务测试"
            description={`使用当前服务商 ${provider || '未配置'} 临时中译英，不修改商品或装修正文。结果可能命中共享缓存，不能单凭结果认定服务商连接已验证。`}
            onClose={() => {
                if (!state.loading && !actionLock.current) onClose();
            }}
            actions={
                <div className="flex flex-wrap justify-end gap-2">
                    <AdminButton
                        type="button"
                        onClick={onClose}
                        disabled={state.loading}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                    >
                        关闭
                    </AdminButton>
                    <AdminButton
                        type="button"
                        onClick={() => void run()}
                        disabled={state.loading || !configured || !source.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {state.loading ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <FlaskConical className="h-3.5 w-3.5" />
                        )}
                        执行测试
                    </AdminButton>
                </div>
            }
        >
            <div className="flex justify-end">
                <AdminSelect
                    value={format}
                    disabled={state.loading}
                    onChange={event => setFormat(event.target.value as 'TEXT' | 'HTML')}
                    className={inputClass}
                >
                    <option value="TEXT">纯文本</option>
                    <option value="HTML">HTML</option>
                </AdminSelect>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="中文源内容">
                    <AdminTextArea
                        rows={8}
                        value={source}
                        disabled={state.loading}
                        onChange={event => {
                            setSource(event.target.value);
                            setTranslated('');
                        }}
                        className={inputClass}
                        placeholder="输入需要测试的中文"
                    />
                </Field>
                <Field label="English 结果">
                    <AdminTextArea
                        rows={8}
                        value={translated}
                        readOnly
                        className={`${inputClass} bg-slate-50`}
                        placeholder="翻译结果将显示在这里"
                    />
                </Field>
            </div>
            {!configured && <p className="mt-3 text-xs text-amber-700">服务未配置，无法测试。</p>}
            {error && (
                <p role="alert" className="mt-3 text-xs text-rose-700">
                    {error}
                </p>
            )}
            {translated && (
                <p role="status" className="mt-3 text-xs text-slate-500">
                    已取得译文；服务商实时连通与额度仍需独立核验。
                </p>
            )}
        </Modal>
    );
}

function StatusBadge({ status }: { status: string }) {
    const classes = [
        'SYNCED',
        'TRANSLATED',
        'CURRENT',
        'AUTO_TRANSLATED',
        'REVIEWED',
        'MANUAL_LOCKED',
    ].includes(status)
        ? 'bg-emerald-50 text-emerald-700'
        : ['FAILED', 'ERROR', 'MISSING'].includes(status)
          ? 'bg-rose-50 text-rose-700'
          : status === 'TRANSLATING'
            ? 'bg-blue-50 text-blue-700'
            : ['STALE', 'REVIEW_REQUIRED', 'PENDING'].includes(status)
              ? 'bg-amber-50 text-amber-700'
              : 'bg-slate-100 text-slate-600';
    return (
        <span className={`rounded px-2 py-0.5 text-[9px] font-bold ${classes}`}>
            {getTranslationStatusLabel(status)}
        </span>
    );
}
function originLabel(origin: string) {
    const labels: Record<string, string> = {
        AUTO: '自动翻译',
        MANUAL: '人工编辑',
        BACKFILL: '历史补齐',
        SOURCE: '源内容',
    };
    return getSystemLabel(origin, labels, 'zh', 'source');
}
function entityLabel(type: string) {
    return getSystemLabel(type, Object.fromEntries(entityOptions), 'zh', 'type');
}
function Metric({
    label,
    value,
    detail,
    tone = 'slate',
    onClick,
}: {
    label: string;
    value: string;
    detail: string;
    tone?: 'slate' | 'green' | 'amber';
    onClick?: () => void;
}) {
    const color =
        tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
    const content = (
        <>
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
            <div className="mt-1 text-[10px] text-slate-400">{detail}</div>
        </>
    );
    const className =
        'border-b border-slate-100 p-4 text-left last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0';
    return onClick ? (
        <AdminButton type="button" className={className} onClick={onClick} aria-label={`筛选${label}`}>
            {content}
        </AdminButton>
    ) : (
        <div className={className}>{content}</div>
    );
}
function ResultMetric({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <div className="text-[10px] text-slate-400">{label}</div>
            <div className="mt-1 font-mono font-bold text-slate-800">{value}</div>
        </div>
    );
}
function Modal({
    title,
    description,
    onClose,
    children,
    actions,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: React.ReactNode;
    actions: React.ReactNode;
}) {
    return (
        <AdminOverlayPortal>
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
            >
                <div className="flex max-h-[calc(100dvh-2rem)] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white p-4 shadow-2xl outline-none sm:p-6">
                    <div className="mb-5 flex shrink-0 items-start justify-between gap-4">
                        <div>
                            <h2 className="font-bold text-slate-900">{title}</h2>
                            {description && (
                                <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                            )}
                        </div>
                        <AdminButton
                            type="button"
                            onClick={onClose}
                            className="p-1 text-slate-400"
                            aria-label="关闭"
                        >
                            <X className="h-5 w-5" />
                        </AdminButton>
                    </div>
                    <div
                        data-translation-dialog-content
                        className="min-h-0 flex-1 overflow-y-auto"
                        role="region"
                        aria-label={`${title}内容`}
                        tabIndex={0}
                    >
                        {children}
                    </div>
                    <footer className="shrink-0 border-t border-slate-100 pt-4">{actions}</footer>
                </div>
            </AccessibleDialogSurface>
        </AdminOverlayPortal>
    );
}

/** A completed request may update only the scope and mounted page that started it. */
function useCurrentTranslationScope() {
    const [scope] = useState(getAdminQueryScope);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    return () => mounted.current && getAdminQueryScope() === scope;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <AdminField
            className="block text-xs font-bold text-slate-700"
            label={
                <>
                    <span className="mb-1.5 block">{label}</span>
                </>
            }
        >
            {children}
        </AdminField>
    );
}
function LoadingState() {
    return (
        <div className="flex min-h-96 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取真实翻译审计数据…
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">翻译审计加载失败</h2>
            <p className="mt-1 max-w-lg text-xs text-rose-600">{toUserFacingError(message)}</p>
            <AdminButton
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
            >
                重试
            </AdminButton>
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
            <AdminButton type="button" onClick={onClose} aria-label="关闭">
                <X className="h-4 w-4" />
            </AdminButton>
        </div>
    );
}
function errorText(error: unknown) {
    return toUserFacingError(error, '翻译操作失败，请稍后重试');
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
