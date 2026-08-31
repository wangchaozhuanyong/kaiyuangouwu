import { useMutation, useQuery } from '@apollo/client/react';
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
import { useMemo, useState } from 'react';
import {
    BACKFILL_CONTENT_TRANSLATIONS_MUTATION,
    CONTENT_TRANSLATION_AUDIT_QUERY,
    TEST_CONTENT_TRANSLATION_MUTATION,
    type ContentTranslationAuditResult,
    type ContentTranslationStateRecord,
} from '../../graphql/plugins.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { toUserFacingError } from '../../utils/user-facing-error';
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
    ['StorePromotionCampaign', '店铺促销'],
    ['AutoCardConfig', '卡密交付配置'],
    ['StorefrontReviewMerchantResponse', '评价商家回复'],
    ['AfterSalesResolution', '售后处理结果'],
] as const;

export function TranslationsModule() {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('ALL');
    const [entityType, setEntityType] = useState('ALL');
    const [backfillOpen, setBackfillOpen] = useState(false);
    const [testOpen, setTestOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<ContentTranslationAuditResult>(CONTENT_TRANSLATION_AUDIT_QUERY, {
        variables: { channelId: null },
        fetchPolicy: 'cache-and-network',
    });
    const audit = query.data?.contentTranslationAudit;
    const states = useMemo(
        () =>
            (audit?.states ?? []).filter(item => {
                if (status !== 'ALL' && item.status !== status) return false;
                if (entityType !== 'ALL' && item.entityType !== entityType) return false;
                if (search.trim()) {
                    const haystack =
                        `${item.entityType} ${item.entityId} ${item.fieldPath} ${item.status} ${item.error ?? ''}`.toLowerCase();
                    if (!haystack.includes(search.trim().toLowerCase())) return false;
                }
                return true;
            }),
        [audit?.states, entityType, search, status],
    );
    const statusOptions = ['ALL', ...new Set((audit?.counts ?? []).map(item => item.status))];

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Languages className="h-5 w-5 text-blue-600" />
                            客户可见内容翻译
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            审计中英文同步状态，补齐历史内容；静态界面词典不属于该后端插件
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setTestOpen(true)}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                        >
                            <FlaskConical className="h-3.5 w-3.5" />
                            测试翻译
                        </button>
                        <button
                            type="button"
                            onClick={() => setBackfillOpen(true)}
                            disabled={!audit?.configured}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            <WandSparkles className="h-3.5 w-3.5" />
                            补齐历史翻译
                        </button>
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className="rounded-lg border border-slate-300 p-2 text-slate-600"
                            aria-label="刷新"
                        >
                            <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                {query.loading && !query.data ? (
                    <LoadingState />
                ) : query.error ? (
                    <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                ) : (
                    audit && (
                        <>
                            <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
                                <Metric
                                    label="翻译服务"
                                    value={audit.configured ? '已配置' : '未配置'}
                                    detail={audit.provider || '无可用服务商'}
                                    tone={audit.configured ? 'green' : 'amber'}
                                />
                                <Metric
                                    label="审计记录"
                                    value={`${audit.total} 项`}
                                    detail={`${audit.counts.length} 种状态`}
                                />
                                <Metric
                                    label="待人工复核"
                                    value={`${query.data?.contentTranslationStaleCount ?? 0} 项`}
                                    detail="人工英文不会被自动覆盖"
                                    tone={
                                        (query.data?.contentTranslationStaleCount ?? 0) > 0
                                            ? 'amber'
                                            : 'green'
                                    }
                                />
                                <Metric
                                    label="当前店铺"
                                    value={query.data?.activeChannel.code ?? '—'}
                                    detail={
                                        (query.data?.activeChannel.availableLanguageCodes ?? []).join(
                                            ' / ',
                                        ) || '未返回语言'
                                    }
                                />
                            </section>
                            {!audit.configured && (
                                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                                    <strong>自动翻译服务未配置。</strong>
                                    当前可以查看已有审计记录，但不能执行测试或历史补齐。API Key
                                    需要由部署环境变量提供，不在页面中明文保存。
                                </section>
                            )}
                            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
                                    <div>
                                        <h2 className="text-sm font-bold text-slate-900">字段翻译审计</h2>
                                        <p className="mt-1 text-[11px] text-slate-400">
                                            记录每个客户可见字段的来源、锁定与错误状态
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                            <input
                                                value={search}
                                                onChange={event => setSearch(event.target.value)}
                                                aria-label="搜索翻译审计记录"
                                                placeholder="搜索实体、ID 或字段"
                                                className={`${inputClass} w-60 pl-8`}
                                            />
                                        </div>
                                        <select
                                            value={entityType}
                                            onChange={event => setEntityType(event.target.value)}
                                            aria-label="筛选内容类型"
                                            className={inputClass}
                                        >
                                            <option value="ALL">全部内容类型</option>
                                            {entityOptions.slice(1).map(([value, label]) => (
                                                <option key={value} value={value}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                        <select
                                            value={status}
                                            onChange={event => setStatus(event.target.value)}
                                            aria-label="筛选翻译状态"
                                            className={inputClass}
                                        >
                                            {statusOptions.map(value => (
                                                <option key={value} value={value}>
                                                    {value === 'ALL' ? '全部状态' : statusLabel(value)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[1050px] text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                                                <th className="p-3">内容类型 / ID</th>
                                                <th className="p-3">字段</th>
                                                <th className="p-3">语言</th>
                                                <th className="p-3">状态</th>
                                                <th className="p-3">来源</th>
                                                <th className="p-3">人工锁定</th>
                                                <th className="p-3">错误</th>
                                                <th className="p-3">更新时间</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {states.map(item => (
                                                <AuditRow key={item.id} item={item} />
                                            ))}
                                            {!states.length && (
                                                <tr>
                                                    <td
                                                        colSpan={8}
                                                        className="p-12 text-center text-xs text-slate-400"
                                                    >
                                                        当前条件下没有审计记录
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="border-t border-slate-100 px-4 py-3 text-[10px] text-slate-400">
                                    显示 {states.length} / {audit.states.length} 项
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
                    onCompleted={async message => {
                        setNotice(message);
                        setActionError('');
                        await query.refetch();
                    }}
                    onError={message => {
                        setActionError(message);
                        setNotice('');
                    }}
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

function AuditRow({ item }: { item: ContentTranslationStateRecord }) {
    return (
        <tr className="hover:bg-slate-50">
            <td className="p-3">
                <div className="font-bold text-slate-800">{entityLabel(item.entityType)}</div>
                <div
                    className="mt-1 max-w-48 truncate font-mono text-[9px] text-slate-400"
                    title={item.entityId}
                >
                    {item.entityId}
                </div>
            </td>
            <td className="p-3 font-mono text-[10px] text-slate-600">{item.fieldPath}</td>
            <td className="p-3 font-mono text-[10px] text-slate-500">
                {item.sourceLanguageCode} → {item.targetLanguageCode}
            </td>
            <td className="p-3">
                <StatusBadge status={item.status} />
            </td>
            <td className="p-3 text-[10px] text-slate-500">{originLabel(item.origin)}</td>
            <td className="p-3">
                {item.locked ? (
                    <span className="font-bold text-amber-700">已锁定</span>
                ) : (
                    <span className="text-slate-400">未锁定</span>
                )}
            </td>
            <td className="max-w-64 p-3">
                <span className="line-clamp-2 text-[10px] text-rose-600" title={item.error ?? ''}>
                    {item.error ?? '—'}
                </span>
            </td>
            <td className="p-3 font-mono text-[10px] text-slate-400">{formatDateTime(item.updatedAt)}</td>
        </tr>
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
    const [result, setResult] = useState<{
        total: number;
        scanned: number;
        processed: number;
        failed: number;
        nextOffset: number;
        hasMore: boolean;
        errors: string[];
    } | null>(null);
    const [backfill, state] = useMutation<{
        backfillCustomerContentTranslations: {
            total: number;
            scanned: number;
            processed: number;
            failed: number;
            nextOffset: number;
            hasMore: boolean;
            errors: string[];
        };
    }>(BACKFILL_CONTENT_TRANSLATIONS_MUTATION);
    const run = async () => {
        if (!configured) return;
        try {
            const response = await backfill({
                variables: { entityType: entityType === 'ALL' ? null : entityType, limit: 100, offset },
            });
            const next = response.data?.backfillCustomerContentTranslations;
            if (!next) throw new Error('后端未返回补齐结果');
            setResult(next);
            setOffset(next.nextOffset);
            if (!next.hasMore)
                await onCompleted(`历史翻译补齐完成：处理 ${next.processed} 项，失败 ${next.failed} 项`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="补齐历史客户可见内容"
            description="每批最多扫描 100 项，人工编辑并锁定的英文不会被覆盖"
            onClose={onClose}
        >
            <Field label="内容类型">
                <select
                    value={entityType}
                    onChange={event => {
                        setEntityType(event.target.value);
                        setOffset(0);
                        setResult(null);
                    }}
                    disabled={state.loading || offset > 0}
                    className={inputClass}
                >
                    {entityOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            </Field>
            {!configured && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    翻译服务未配置，无法执行补齐。
                </p>
            )}
            {result && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <ResultMetric label="总量" value={result.total} />
                        <ResultMetric label="本批扫描" value={result.scanned} />
                        <ResultMetric label="已处理" value={result.processed} />
                        <ResultMetric label="失败" value={result.failed} />
                    </div>
                    {result.errors.length > 0 && (
                        <div className="mt-3 max-h-32 overflow-y-auto rounded bg-rose-50 p-2 text-[10px] text-rose-700">
                            {result.errors.map((error, index) => (
                                <div key={index}>{error}</div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={state.loading}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                >
                    {result && !result.hasMore ? '关闭' : '取消'}
                </button>
                {(!result || result.hasMore) && (
                    <button
                        type="button"
                        onClick={() => void run()}
                        disabled={state.loading || !configured}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {state.loading ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Play className="h-3.5 w-3.5" />
                        )}
                        {result ? '继续下一批' : '开始第一批'}
                    </button>
                )}
            </div>
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
    const [test, state] = useMutation<{
        translateCustomerContent: {
            configured: boolean;
            provider: string;
            translations: Array<{ key: string; text: string }>;
        };
    }>(TEST_CONTENT_TRANSLATION_MUTATION);
    const run = async () => {
        if (!configured || !source.trim()) return;
        try {
            const response = await test({
                variables: { segments: [{ key: 'preview', text: source.trim(), format }] },
            });
            const result = response.data?.translateCustomerContent;
            if (!result?.configured) throw new Error('翻译服务未配置');
            setTranslated(result.translations.find(item => item.key === 'preview')?.text ?? '');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="翻译服务测试"
            description={`使用当前服务商 ${provider || '未配置'} 执行一次临时中译英，不写入业务数据`}
            onClose={onClose}
        >
            <div className="flex justify-end">
                <select
                    value={format}
                    onChange={event => setFormat(event.target.value as 'TEXT' | 'HTML')}
                    className={inputClass}
                >
                    <option value="TEXT">纯文本</option>
                    <option value="HTML">HTML</option>
                </select>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="中文源内容">
                    <textarea
                        rows={8}
                        value={source}
                        onChange={event => setSource(event.target.value)}
                        className={inputClass}
                        placeholder="输入需要测试的中文"
                    />
                </Field>
                <Field label="English 结果">
                    <textarea
                        rows={8}
                        value={translated}
                        readOnly
                        className={`${inputClass} bg-slate-50`}
                        placeholder="翻译结果将显示在这里"
                    />
                </Field>
            </div>
            {!configured && <p className="mt-3 text-xs text-amber-700">服务未配置，无法测试。</p>}
            <div className="mt-5 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                >
                    关闭
                </button>
                <button
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
                </button>
            </div>
        </Modal>
    );
}

function StatusBadge({ status }: { status: string }) {
    const classes = ['SYNCED', 'TRANSLATED', 'CURRENT'].includes(status)
        ? 'bg-emerald-50 text-emerald-700'
        : ['FAILED', 'ERROR'].includes(status)
          ? 'bg-rose-50 text-rose-700'
          : ['STALE', 'REVIEW_REQUIRED', 'PENDING'].includes(status)
            ? 'bg-amber-50 text-amber-700'
            : 'bg-slate-100 text-slate-600';
    return (
        <span className={`rounded px-2 py-0.5 text-[9px] font-bold ${classes}`}>{statusLabel(status)}</span>
    );
}
function statusLabel(status: string) {
    const labels: Record<string, string> = {
        SYNCED: '已同步',
        TRANSLATED: '已翻译',
        CURRENT: '已是最新',
        STALE: '待复核',
        REVIEW_REQUIRED: '待人工复核',
        PENDING: '待处理',
        FAILED: '失败',
        ERROR: '错误',
        LOCKED: '人工锁定',
    };
    return labels[status] ?? status;
}
function originLabel(origin: string) {
    const labels: Record<string, string> = {
        AUTO: '自动翻译',
        MANUAL: '人工编辑',
        BACKFILL: '历史补齐',
        SOURCE: '源内容',
    };
    return labels[origin] ?? origin;
}
function entityLabel(type: string) {
    return entityOptions.find(item => item[0] === type)?.[1] ?? type;
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
    tone?: 'slate' | 'green' | 'amber';
}) {
    const color =
        tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
    return (
        <div className="border-b border-slate-100 p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
            <div className="mt-1 text-[10px] text-slate-400">{detail}</div>
        </div>
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
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const { dialogRef, titleId } = useAccessibleDialog(onClose);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div
                ref={dialogRef as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none"
            >
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 id={titleId} className="font-bold text-slate-900">
                            {title}
                        </h2>
                        {description && (
                            <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                        )}
                    </div>
                    <button type="button" onClick={onClose} className="p-1 text-slate-400" aria-label="关闭">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </div>
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
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
            >
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
    return toUserFacingError(error, '翻译操作失败，请稍后重试');
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
