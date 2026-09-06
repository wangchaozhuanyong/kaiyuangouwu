import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Copy,
    Eye,
    KeyRound,
    LoaderCircle,
    PackageCheck,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldOff,
    X,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import {
    AUTO_CARD_VARIANTS_QUERY,
    AUTO_CARD_WORKSPACE_QUERY,
    RETRY_AUTO_CARD_DELIVERY_MUTATION,
    REVEAL_AUTO_CARD_ITEM_MUTATION,
    SET_AUTO_CARD_ITEM_ENABLED_MUTATION,
    type AutoCardDeliveryRecord,
    type AutoCardFieldRecord,
    type AutoCardPoolItemRecord,
    type AutoCardVariantsResult,
    type AutoCardWorkspaceResult,
} from '../../graphql/fulfillment.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, getOrderStateLabel } from './sales-utils';

type Tab = 'POOL' | 'DELIVERIES';
const CARD_POOL_TABS = { pool: 'POOL', deliveries: 'DELIVERIES' } as const;
const VARIANT_LOOKUP_SIZE = 50;

export function CardPoolModule() {
    const [selectedVariantId, setSelectedVariantId] = useState('');
    const [tab, setTab] = useUrlTab<Tab>(CARD_POOL_TABS, 'pool');
    const [poolState, setPoolState] = useState('ALL');
    const [search, setSearch] = useState('');
    const [variantSearch, setVariantSearch] = useState('');
    const [poolPage, setPoolPage] = useState(0);
    const [poolPageSize, setPoolPageSize] = usePageSize(setPoolPage);
    const [deliveryPage, setDeliveryPage] = useState(0);
    const [deliveryPageSize, setDeliveryPageSize] = usePageSize(setDeliveryPage);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const deferredVariantSearch = useDeferredValue(variantSearch.trim());
    const variantsQuery = useQuery<AutoCardVariantsResult>(AUTO_CARD_VARIANTS_QUERY, {
        variables: {
            options: {
                take: VARIANT_LOOKUP_SIZE,
                sort: { name: 'ASC', id: 'ASC' },
                filter: {
                    _and: [
                        { fulfillmentType: { eq: 'digital' } },
                        { digitalDeliveryMode: { eq: 'auto_card' } },
                        ...(deferredVariantSearch
                            ? [
                                  {
                                      _or: [
                                          { name: { contains: deferredVariantSearch } },
                                          { sku: { contains: deferredVariantSearch } },
                                      ],
                                  },
                              ]
                            : []),
                    ],
                },
            },
        },
        fetchPolicy: 'cache-and-network',
    });
    const variants = variantsQuery.data?.productVariants.items ?? [];
    const selectedVariant = variants.find(item => item.id === selectedVariantId) ?? variants[0] ?? null;
    const workspaceQuery = useQuery<AutoCardWorkspaceResult>(AUTO_CARD_WORKSPACE_QUERY, {
        variables: {
            productVariantId: selectedVariant?.id ?? '',
            poolOptions: {
                skip: poolPage * poolPageSize,
                take: poolPageSize,
                state: poolState === 'ALL' ? null : poolState,
            },
            deliveryOptions: {
                productVariantId: selectedVariant?.id ?? '',
                skip: deliveryPage * deliveryPageSize,
                take: deliveryPageSize,
            },
        },
        skip: !selectedVariant,
        fetchPolicy: 'cache-and-network',
        pollInterval: 15_000,
    });
    const config = workspaceQuery.data?.autoCardConfig ?? null;
    const completed = async (message: string) => {
        setNotice(message);
        setActionError('');
        await Promise.all([workspaceQuery.refetch(), variantsQuery.refetch()]);
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <KeyRound className="h-5 w-5 text-blue-600" />
                            发卡记录与异常
                            <FeatureHelpButton topic="sales.card-pool" title="发卡记录与异常" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            跨商品查看卡密库存、交付结果和需要人工处理的问题
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() =>
                                void Promise.all([workspaceQuery.refetch(), variantsQuery.refetch()])
                            }
                            disabled={workspaceQuery.loading || variantsQuery.loading}
                            className={secondaryButton}
                        >
                            <RefreshCw
                                className={`h-4 w-4 ${workspaceQuery.loading || variantsQuery.loading ? 'animate-spin' : ''}`}
                            />
                            刷新
                        </button>
                        {selectedVariant && (
                            <Link
                                to={`/catalog/products/${selectedVariant.product.id}?tab=variants`}
                                className={primaryButton}
                            >
                                <PackageCheck className="h-4 w-4" />
                                回到商品页管理
                            </Link>
                        )}
                    </div>
                </div>
            </header>
            <main className="w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
                    <label className="block w-full max-w-lg text-[10px] font-bold text-slate-500">
                        查找卡密 SKU
                        <span className="relative mt-1 block">
                            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <input
                                value={variantSearch}
                                onChange={event => {
                                    setVariantSearch(event.target.value);
                                    setSelectedVariantId('');
                                    setPoolPage(0);
                                    setDeliveryPage(0);
                                }}
                                placeholder="输入商品名、规格名或 SKU 编码"
                                className={`${inputClass} pl-8`}
                            />
                        </span>
                    </label>
                    <span className="text-[10px] text-slate-400">
                        {variantsQuery.data
                            ? `找到 ${variantsQuery.data.productVariants.totalItems} 个自动发卡 SKU`
                            : '正在查询…'}
                    </span>
                </section>
                {variantsQuery.loading && !variantsQuery.data ? (
                    <LoadingState text="正在读取卡密 SKU…" />
                ) : variantsQuery.error ? (
                    <ErrorState
                        message={variantsQuery.error.message}
                        onRetry={() => void variantsQuery.refetch()}
                    />
                ) : !variants.length ? (
                    <EmptyState />
                ) : (
                    <>
                        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
                            <div>
                                <div className="text-[10px] font-bold text-slate-400">当前卡密 SKU</div>
                                <select
                                    value={selectedVariant?.id ?? ''}
                                    onChange={event => {
                                        setSelectedVariantId(event.target.value);
                                        setPoolPage(0);
                                        setDeliveryPage(0);
                                    }}
                                    className={`${inputClass} mt-1 min-w-80`}
                                >
                                    {variants.map(item => (
                                        <option key={item.id} value={item.id}>
                                            {item.product.name} / {item.name} · {item.sku}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {config ? (
                                <div className="flex flex-wrap gap-2 text-[10px]">
                                    <StatusPill
                                        ok={config.enabled}
                                        text={config.enabled ? '自动发卡已启用' : '自动发卡已停用'}
                                    />
                                    <StatusPill
                                        ok={config.availableCount > config.lowStockThreshold}
                                        text={
                                            config.availableCount > config.lowStockThreshold
                                                ? '库存充足'
                                                : '低库存预警'
                                        }
                                    />
                                    <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">
                                        格式：{config.formatName} · 分隔符 {config.delimiter}
                                    </span>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    <span>该 SKU 尚未完成自动发卡设置。</span>
                                    <Link
                                        to={`/catalog/products/${selectedVariant.product.id}?tab=variants`}
                                        className="font-semibold underline underline-offset-2"
                                    >
                                        回到商品页继续设置
                                    </Link>
                                </div>
                            )}
                        </section>
                        {config && (
                            <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3 xl:grid-cols-6">
                                <Metric
                                    label="可用库存"
                                    value={config.availableCount}
                                    tone={
                                        config.availableCount <= config.lowStockThreshold ? 'amber' : 'green'
                                    }
                                />
                                <Metric label="已分配" value={config.assignedCount} />
                                <Metric label="已停用" value={config.disabledCount} />
                                <Metric
                                    label="待库存交付"
                                    value={config.waitingDeliveryCount}
                                    tone={config.waitingDeliveryCount ? 'rose' : 'slate'}
                                />
                                <Metric
                                    label="低库存 SKU"
                                    value={variantsQuery.data?.autoCardTodoSummary.lowStockSkuCount ?? 0}
                                    tone="amber"
                                />
                                <Metric
                                    label="人工复核"
                                    value={variantsQuery.data?.autoCardTodoSummary.manualReviewCount ?? 0}
                                    tone="rose"
                                />
                            </section>
                        )}
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="inline-flex w-max rounded-lg border border-slate-200 bg-white p-1">
                                <TabButton active={tab === 'POOL'} onClick={() => setTab('POOL')}>
                                    库存明细 {workspaceQuery.data?.autoCardPoolItems.totalItems ?? 0}
                                </TabButton>
                                <TabButton active={tab === 'DELIVERIES'} onClick={() => setTab('DELIVERIES')}>
                                    交付记录 {workspaceQuery.data?.autoCardDeliveries.totalItems ?? 0}
                                </TabButton>
                            </div>
                            {tab === 'POOL' && (
                                <div className="flex gap-2">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                        <input
                                            value={search}
                                            onChange={event => setSearch(event.target.value)}
                                            placeholder="筛选当前页序号或脱敏字段"
                                            className={`${inputClass} w-64 pl-8`}
                                        />
                                    </div>
                                    <select
                                        value={poolState}
                                        onChange={event => {
                                            setPoolState(event.target.value);
                                            setPoolPage(0);
                                        }}
                                        className={inputClass}
                                    >
                                        <option value="ALL">全部状态</option>
                                        <option value="AVAILABLE">可用</option>
                                        <option value="ASSIGNED">已分配</option>
                                        <option value="DISABLED">已停用</option>
                                    </select>
                                </div>
                            )}
                        </div>
                        {workspaceQuery.loading && !workspaceQuery.data ? (
                            <LoadingState text="正在读取真实卡密库存…" />
                        ) : workspaceQuery.error ? (
                            <ErrorState
                                message={workspaceQuery.error.message}
                                onRetry={() => void workspaceQuery.refetch()}
                            />
                        ) : tab === 'POOL' ? (
                            <div className="space-y-3">
                                <PoolTable
                                    items={workspaceQuery.data?.autoCardPoolItems.items ?? []}
                                    search={search}
                                    onChanged={completed}
                                    onError={setActionError}
                                />
                                <Pagination
                                    page={poolPage}
                                    pageSize={poolPageSize}
                                    onPageSizeChange={setPoolPageSize}
                                    totalItems={workspaceQuery.data?.autoCardPoolItems.totalItems ?? 0}
                                    loading={workspaceQuery.loading}
                                    onPageChange={setPoolPage}
                                />
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <DeliveriesTable
                                    items={workspaceQuery.data?.autoCardDeliveries.items ?? []}
                                    onChanged={completed}
                                    onError={setActionError}
                                />
                                <Pagination
                                    page={deliveryPage}
                                    pageSize={deliveryPageSize}
                                    onPageSizeChange={setDeliveryPageSize}
                                    totalItems={workspaceQuery.data?.autoCardDeliveries.totalItems ?? 0}
                                    loading={workspaceQuery.loading}
                                    onPageChange={setDeliveryPage}
                                />
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

function PoolTable({
    items,
    search,
    onChanged,
    onError,
}: {
    items: AutoCardPoolItemRecord[];
    search: string;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [revealed, setRevealed] = useState<{ id: string; fields: AutoCardFieldRecord[] } | null>(null);
    const [disableItem, setDisableItem] = useState<AutoCardPoolItemRecord | null>(null);
    const [reveal, revealState] = useMutation<{ revealAutoCardPoolItem: AutoCardFieldRecord[] }>(
        REVEAL_AUTO_CARD_ITEM_MUTATION,
    );
    const [setEnabled, enabledState] = useMutation(SET_AUTO_CARD_ITEM_ENABLED_MUTATION);
    const filtered = items.filter(
        item =>
            !search.trim() ||
            `${item.sequence} ${item.maskedFields.map(field => field.value).join(' ')}`
                .toLowerCase()
                .includes(search.trim().toLowerCase()),
    );
    const revealItem = async (item: AutoCardPoolItemRecord) => {
        if (
            !(await requestConfirmation({
                title: '查看完整卡密？',
                description: '卡密属于敏感信息。请确认当前环境安全，并且本次查看确有业务需要。',
                confirmLabel: '查看明文',
                tone: 'warning',
            }))
        )
            return;
        try {
            const response = await reveal({ variables: { id: item.id } });
            const fields = response.data?.revealAutoCardPoolItem;
            if (!fields) throw new Error('后端未返回卡密字段');
            setRevealed({ id: item.id, fields });
        } catch (error) {
            onError(errorText(error));
        }
    };
    const enable = async (item: AutoCardPoolItemRecord) => {
        try {
            await setEnabled({ variables: { id: item.id, enabled: true, reason: null } });
            await onChanged('卡密已恢复为可用状态');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1320px] border-collapse text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th
                                scope="col"
                                className="sticky left-0 z-20 w-24 whitespace-nowrap bg-slate-50 px-3 py-3"
                            >
                                序号
                            </th>
                            <th scope="col" className="w-72 whitespace-nowrap px-3 py-3">
                                卡密摘要（脱敏）
                            </th>
                            <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                状态
                            </th>
                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                入库时间
                            </th>
                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                分配时间
                            </th>
                            <th scope="col" className="w-52 whitespace-nowrap px-3 py-3">
                                关联交付
                            </th>
                            <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                停用原因
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
                        {filtered.map(item => {
                            const firstField = item.maskedFields[0];
                            const fieldSummary = firstField
                                ? `${firstField.label}：${firstField.value}`
                                : '无字段';
                            return (
                                <tr key={item.id} className="group h-[52px] hover:bg-slate-50">
                                    <td className="sticky left-0 z-10 h-[52px] whitespace-nowrap bg-white px-3 py-0 font-mono font-bold text-slate-700 group-hover:bg-slate-50">
                                        #{item.sequence}
                                    </td>
                                    <td className="h-[52px] max-w-72 px-3 py-0">
                                        <div className="flex max-w-68 items-center gap-1 whitespace-nowrap">
                                            <code
                                                className="min-w-0 truncate font-mono text-[10px] text-slate-700"
                                                title={fieldSummary}
                                            >
                                                {fieldSummary}
                                            </code>
                                            {item.maskedFields.length > 1 && (
                                                <span className="shrink-0 text-[9px] font-bold text-blue-700">
                                                    +{item.maskedFields.length - 1}字段
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                        <PoolStateBadge state={item.state} />
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {formatDateTime(item.createdAt)}
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {item.assignedAt ? formatDateTime(item.assignedAt) : '—'}
                                    </td>
                                    <td className="h-[52px] max-w-52 px-3 py-0 font-mono text-[10px] text-slate-500">
                                        <span className="block truncate" title={item.deliveryId ?? undefined}>
                                            {item.deliveryId ?? '—'}
                                        </span>
                                    </td>
                                    <td className="h-[52px] max-w-56 px-3 py-0 text-[10px] text-rose-600">
                                        <span
                                            className="block truncate"
                                            title={item.disabledReason ?? undefined}
                                        >
                                            {item.disabledReason ?? '—'}
                                        </span>
                                    </td>
                                    <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 group-hover:bg-slate-50">
                                        <div className="flex justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => void revealItem(item)}
                                                disabled={revealState.loading}
                                                className={iconButton}
                                                aria-label="查看明文"
                                            >
                                                <Eye className="h-4 w-4" />
                                            </button>
                                            {item.state === 'AVAILABLE' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setDisableItem(item)}
                                                    className={`${iconButton} text-rose-600`}
                                                    aria-label="停用"
                                                >
                                                    <ShieldOff className="h-4 w-4" />
                                                </button>
                                            )}
                                            {item.state === 'DISABLED' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void enable(item)}
                                                    disabled={enabledState.loading}
                                                    className={`${iconButton} text-emerald-600`}
                                                    aria-label="恢复可用"
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {!filtered.length && <EmptyRow colSpan={8} text="当前条件下没有卡密库存" />}
                    </tbody>
                </table>
            </div>
            {revealed && <RevealDialog value={revealed} onClose={() => setRevealed(null)} />}
            {disableItem && (
                <DisableDialog
                    item={disableItem}
                    onClose={() => setDisableItem(null)}
                    onCompleted={async () => {
                        setDisableItem(null);
                        await onChanged('卡密已停用，不会再自动分配');
                    }}
                    onError={onError}
                />
            )}
        </section>
    );
}

function DeliveriesTable({
    items,
    onChanged,
    onError,
}: {
    items: AutoCardDeliveryRecord[];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [retry, state] = useMutation(RETRY_AUTO_CARD_DELIVERY_MUTATION);
    const resend = async (item: AutoCardDeliveryRecord) => {
        if (
            !(await requestConfirmation({
                title: `重试订单 ${item.order.code} 的卡密交付？`,
                description: '系统会沿用原卡密重新分配或发送，不会重复出库。',
                confirmLabel: '确认重试',
                tone: 'warning',
            }))
        )
            return;
        try {
            await retry({ variables: { id: item.id } });
            await onChanged('卡密交付重试已进入队列');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1680px] border-collapse text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th
                                scope="col"
                                className="sticky left-0 z-20 w-44 whitespace-nowrap bg-slate-50 px-3 py-3"
                            >
                                订单号
                            </th>
                            <th scope="col" className="w-32 whitespace-nowrap px-3 py-3">
                                订单状态
                            </th>
                            <th scope="col" className="w-60 whitespace-nowrap px-3 py-3">
                                商品名称
                            </th>
                            <th scope="col" className="w-44 whitespace-nowrap px-3 py-3">
                                SKU
                            </th>
                            <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                收件邮箱
                            </th>
                            <th scope="col" className="w-20 whitespace-nowrap px-3 py-3">
                                数量
                            </th>
                            <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                交付状态
                            </th>
                            <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                尝试次数
                            </th>
                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                发送时间
                            </th>
                            <th scope="col" className="w-64 whitespace-nowrap px-3 py-3">
                                错误
                            </th>
                            <th
                                scope="col"
                                className="sticky right-0 z-20 w-32 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                            >
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.map(item => (
                            <tr key={item.id} className="group h-[52px] hover:bg-slate-50">
                                <td className="sticky left-0 z-10 h-[52px] max-w-44 bg-white px-3 py-0 font-mono font-bold text-blue-700 group-hover:bg-slate-50">
                                    <span className="block truncate" title={item.order.code}>
                                        {item.order.code}
                                    </span>
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 text-[10px] text-slate-500">
                                    {getOrderStateLabel(item.order.state)}
                                </td>
                                <td className="h-[52px] max-w-60 px-3 py-0">
                                    <strong
                                        className="block truncate text-slate-800"
                                        title={item.productName}
                                    >
                                        {item.productName}
                                    </strong>
                                </td>
                                <td className="h-[52px] max-w-44 px-3 py-0 font-mono text-[10px] text-slate-500">
                                    <span className="block truncate" title={item.sku}>
                                        {item.sku}
                                    </span>
                                </td>
                                <td className="h-[52px] max-w-56 px-3 py-0 text-slate-600">
                                    <span className="block truncate" title={item.recipientEmail}>
                                        {item.recipientEmail}
                                    </span>
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold">
                                    {item.quantity}
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                    <DeliveryStateBadge state={item.state} />
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-slate-500">
                                    {item.attemptCount}
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                    {item.sentAt ? formatDateTime(item.sentAt) : '—'}
                                </td>
                                <td className="h-[52px] max-w-64 px-3 py-0">
                                    <span
                                        className="block truncate text-[10px] text-rose-600"
                                        title={item.lastError ?? ''}
                                    >
                                        {item.lastError ?? '—'}
                                    </span>
                                </td>
                                <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 text-right group-hover:bg-slate-50">
                                    <button
                                        type="button"
                                        onClick={() => void resend(item)}
                                        disabled={state.loading}
                                        className={secondaryButton}
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        {item.state === 'SENT' ? '重新发送' : '重试交付'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!items.length && <EmptyRow colSpan={9} text="当前 SKU 暂无卡密交付记录" />}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function RevealDialog({
    value,
    onClose,
}: {
    value: { id: string; fields: AutoCardFieldRecord[] };
    onClose: () => void;
}) {
    const [copied, setCopied] = useState('');
    return (
        <Modal
            title="卡密明文"
            description="敏感操作已由后端权限控制，请勿在不安全环境截图或转发"
            onClose={onClose}
        >
            <div className="space-y-2">
                {value.fields.map(field => (
                    <div
                        key={field.key}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
                    >
                        <div>
                            <div className="text-[9px] text-slate-400">{field.label}</div>
                            <code className="mt-1 block break-all font-mono text-xs font-bold text-slate-800">
                                {field.value}
                            </code>
                        </div>
                        <button
                            type="button"
                            aria-label={`复制${field.label}`}
                            title={`复制${field.label}`}
                            onClick={async () => {
                                await navigator.clipboard.writeText(field.value);
                                setCopied(field.key);
                            }}
                            className={iconButton}
                        >
                            {copied === field.key ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                                <Copy className="h-4 w-4" />
                            )}
                        </button>
                    </div>
                ))}
            </div>
            <div className="mt-5 flex justify-end">
                <button type="button" onClick={onClose} className={primaryButton}>
                    关闭明文
                </button>
            </div>
        </Modal>
    );
}
function DisableDialog({
    item,
    onClose,
    onCompleted,
    onError,
}: {
    item: AutoCardPoolItemRecord;
    onClose: () => void;
    onCompleted: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const [reason, setReason] = useState('');
    const [setEnabled, state] = useMutation(SET_AUTO_CARD_ITEM_ENABLED_MUTATION);
    const submit = async () => {
        if (!reason.trim()) return onError('请填写停用原因');
        try {
            await setEnabled({ variables: { id: item.id, enabled: false, reason: reason.trim() } });
            await onCompleted();
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={`停用卡密 #${item.sequence}`}
            description="停用后不会被新订单分配，之后可以恢复"
            onClose={onClose}
        >
            <Field label="停用原因 *">
                <textarea
                    rows={4}
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                    className={inputClass}
                    autoFocus
                />
            </Field>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="确认停用"
            />
        </Modal>
    );
}
function PoolStateBadge({ state }: { state: AutoCardPoolItemRecord['state'] }) {
    const labels = { AVAILABLE: '可用', ASSIGNED: '已分配', DISABLED: '已停用' };
    const classes =
        state === 'AVAILABLE'
            ? 'bg-emerald-50 text-emerald-700'
            : state === 'ASSIGNED'
              ? 'bg-blue-50 text-blue-700'
              : 'bg-slate-100 text-slate-500';
    return <span className={`rounded px-2 py-1 text-[9px] font-bold ${classes}`}>{labels[state]}</span>;
}
function DeliveryStateBadge({ state }: { state: AutoCardDeliveryRecord['state'] }) {
    const labels = {
        WAITING_STOCK: '等待库存',
        ALLOCATED: '已分配待发送',
        RETRYING: '重试中',
        SENT: '已发送',
        MANUAL_REVIEW: '人工复核',
    };
    const classes =
        state === 'SENT'
            ? 'bg-emerald-50 text-emerald-700'
            : state === 'MANUAL_REVIEW' || state === 'WAITING_STOCK'
              ? 'bg-rose-50 text-rose-700'
              : 'bg-blue-50 text-blue-700';
    return <span className={`rounded px-2 py-1 text-[9px] font-bold ${classes}`}>{labels[state]}</span>;
}
function StatusPill({ ok, text }: { ok: boolean; text: string }) {
    return (
        <span
            className={`rounded px-2 py-1 font-bold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
        >
            {text}
        </span>
    );
}
function Metric({
    label,
    value,
    tone = 'slate',
}: {
    label: string;
    value: number;
    tone?: 'slate' | 'green' | 'amber' | 'rose';
}) {
    const colors = {
        slate: 'text-slate-900',
        green: 'text-emerald-700',
        amber: 'text-amber-700',
        rose: 'text-rose-700',
    };
    return (
        <div className="border-b border-slate-100 p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[9px] font-bold text-slate-400">{label}</div>
            <div className={`mt-1 font-mono text-xl font-bold ${colors[tone]}`}>{value}</div>
        </div>
    );
}
function Pagination({
    page,
    pageSize,
    onPageSizeChange,
    totalItems,
    loading,
    onPageChange,
}: {
    page: number;
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    totalItems: number;
    loading: boolean;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    return (
        <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-[10px] text-slate-500">
            <span>
                共 {totalItems} 条，第 {Math.min(page + 1, totalPages)} / {totalPages} 页
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} disabled={loading} />
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={page === 0 || loading}
                    className={iconButton}
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1 || loading}
                    className={iconButton}
                    aria-label="下一页"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-md px-3 py-1.5 text-xs font-bold ${active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
        >
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
                className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="font-bold text-slate-900">{title}</h2>
                        {description && (
                            <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                        )}
                    </div>
                    <button type="button" onClick={onClose} className="p-1 text-slate-400" aria-label="关闭">
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
function EmptyState() {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <PackageCheck className="h-9 w-9 text-slate-300" />
            <h2 className="mt-3 text-sm font-bold text-slate-700">没有自动发卡 SKU</h2>
            <p className="mt-1 max-w-lg text-xs leading-5 text-slate-400">
                请到商品编辑页的“销售与自动发货”完成设置；此页只处理跨商品库存记录和发货异常。
            </p>
        </div>
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
function LoadingState({ text }: { text: string }) {
    return (
        <div className="flex min-h-96 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {text}
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">卡密数据加载失败</h2>
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
    return toUserFacingError(error, '卡密操作失败，请稍后重试');
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400';
const primaryButton =
    'flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
    'flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const iconButton = 'inline-flex rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40';
const theadClass = 'border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500';
