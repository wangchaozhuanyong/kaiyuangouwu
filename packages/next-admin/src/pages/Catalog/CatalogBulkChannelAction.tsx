import { useMutation, useQuery } from '@apollo/client/react';
import { Layers3, Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    GET_CATALOG_CHANNEL_ASSIGNMENTS,
    type CatalogChannelAssignmentsData,
    type ProductChannelAssignment,
} from '../../graphql/catalog-channel-assignments.graphql';
import { ASSIGN_PRODUCTS_TO_CHANNEL, REMOVE_PRODUCTS_FROM_CHANNEL } from '../../graphql/catalog.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';

export function CatalogBulkChannelAction() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [channelId, setChannelId] = useState('');
    const [mode, setMode] = useState<'assign' | 'remove'>('assign');
    const [priceFactor, setPriceFactor] = useState('1');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const [assignmentFilter, setAssignmentFilter] = useState('all');
    const products = useQuery<CatalogChannelAssignmentsData>(GET_CATALOG_CHANNEL_ASSIGNMENTS, {
        variables: {
            options: {
                take: 100,
                sort: { updatedAt: 'DESC', id: 'DESC' },
                ...(deferredSearch ? { filter: { name: { contains: deferredSearch } } } : {}),
            },
        },
        skip: !open,
        fetchPolicy: 'network-only',
        notifyOnNetworkStatusChange: true,
    });
    const [assign, assignState] = useMutation<{ assignProductsToChannel: Array<{ id: string }> }>(
        ASSIGN_PRODUCTS_TO_CHANNEL,
    );
    const [remove, removeState] = useMutation<{
        removeProductsFromChannel: Array<{ id: string }>;
    }>(REMOVE_PRODUCTS_FROM_CHANNEL);
    const busy = pending || assignState.loading || removeState.loading;
    const page = products.data?.catalogProductChannelAssignments;
    const target = page?.channels.find(channel => channel.id === channelId);
    const ready = !products.loading && !products.error && deferredSearch === search.trim();
    const belongsToTarget = (item: ProductChannelAssignment) =>
        item.channels.some(channel => channel.id === channelId);
    const eligible = (item: ProductChannelAssignment) =>
        Boolean(target) &&
        !(mode === 'remove' && item.channels.length <= 1) &&
        (mode === 'assign' ? !belongsToTarget(item) : belongsToTarget(item));
    const items = (page?.items ?? []).filter(
        item =>
            assignmentFilter === 'all' ||
            !target ||
            (assignmentFilter === 'assigned' ? belongsToTarget(item) : !belongsToTarget(item)),
    );
    const selectable = items.filter(eligible);
    const selected = selectable.filter(item => selectedIds.includes(item.id));
    const resetSelection = () => {
        setSelectedIds([]);
        setError('');
        setNotice('');
    };
    const submit = async () => {
        setError('');
        setNotice('');
        if (busy || !ready) return;
        setPending(true);
        try {
            if (!selected.length) throw new Error('请至少选择一个可操作的商品');
            if (!target) throw new Error('请选择目标店铺');
            // Recheck membership immediately before applying a price factor or removing access.
            const latest = (await products.refetch()).data?.catalogProductChannelAssignments;
            if (!latest) throw new Error('无法核对最新店铺分配，请重试');
            if (selected.some(item => !latest.items.some(current => current.id === item.id))) {
                setSelectedIds([]);
                throw new Error('商品列表已变化，请根据刷新后的结果重新选择');
            }
            const ids = latest.items
                .filter(item => selectedIds.includes(item.id) && eligible(item))
                .map(item => item.id);
            const skipped = selected.length - ids.length;
            if (!ids.length) {
                setSelectedIds([]);
                setNotice('分配状态已变化，本次无需操作，列表已刷新');
                return;
            }
            if (mode === 'assign') {
                const factor = Number(priceFactor);
                if (!Number.isFinite(factor) || factor <= 0) throw new Error('价格系数必须大于 0');
                await assign({
                    variables: { input: { productIds: ids, channelId, priceFactor: factor } },
                });
            } else {
                await remove({ variables: { input: { productIds: ids, channelId } } });
            }
            const verified = (await products.refetch()).data?.catalogProductChannelAssignments;
            if (
                !verified ||
                !ids.every(id => {
                    const item = verified.items.find(product => product.id === id);
                    return mode === 'assign'
                        ? Boolean(item && belongsToTarget(item))
                        : !item || !belongsToTarget(item);
                })
            )
                throw new Error('操作已返回，但最新分配状态未能确认，请刷新后核对');
            setNotice(
                `已${mode === 'assign' ? '分配到' : '从'}「${getChannelDisplayName(target.code)}」${mode === 'remove' ? '移除' : ''} ${ids.length} 个商品${skipped ? `，跳过 ${skipped} 个状态已变化的商品` : ''}`,
            );
            setSelectedIds([]);
        } catch (cause) {
            setError(toUserFacingError(cause, '商品批量店铺操作失败'));
            await products.refetch().catch(() => undefined);
        } finally {
            setPending(false);
        }
    };
    return (
        <>
            <button
                type="button"
                onClick={() => {
                    resetSelection();
                    setOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
                <Layers3 className="h-4 w-4" />
                批量店铺
            </button>
            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <AccessibleDialogSurface
                        accessibleName="商品批量店铺操作"
                        onRequestClose={() => !busy && setOpen(false)}
                        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl"
                    >
                        <div className="flex items-start justify-between border-b p-5">
                            <div>
                                <h2 className="flex items-center gap-2 text-base font-bold">
                                    商品批量店铺操作
                                    <FeatureHelpButton topic="catalog.products" title="商品批量店铺操作" />
                                </h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    同一商品可分配到多个店铺。先查看现有分配，再选择需要新增或移除的商品。
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                disabled={busy}
                                aria-label="关闭"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="space-y-4 overflow-y-auto p-5">
                            {notice && <Notice tone="success" message={notice} />}
                            {error && <Notice tone="error" message={error} />}
                            <div className="grid gap-3 sm:grid-cols-3">
                                <label className={labelClass}>
                                    操作
                                    <select
                                        aria-label="操作"
                                        value={mode}
                                        disabled={busy}
                                        onChange={event => {
                                            setMode(event.target.value as 'assign' | 'remove');
                                            resetSelection();
                                        }}
                                        className={inputClass}
                                    >
                                        <option value="assign">分配到店铺</option>
                                        <option value="remove">从店铺移除</option>
                                    </select>
                                </label>
                                <label className={labelClass}>
                                    目标店铺
                                    <select
                                        aria-label="目标店铺"
                                        value={channelId}
                                        disabled={busy || !ready}
                                        onChange={event => {
                                            setChannelId(event.target.value);
                                            resetSelection();
                                        }}
                                        className={inputClass}
                                    >
                                        <option value="">请选择</option>
                                        {page?.channels.map(channel => (
                                            <option key={channel.id} value={channel.id}>
                                                {getChannelDisplayName(channel.code)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {mode === 'assign' && (
                                    <label className={labelClass}>
                                        价格系数
                                        <input
                                            type="number"
                                            min="0.0001"
                                            step="0.01"
                                            value={priceFactor}
                                            disabled={busy}
                                            onChange={event => setPriceFactor(event.target.value)}
                                            className={inputClass}
                                        />
                                    </label>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">
                                已分配的商品会自动跳过，价格系数仅用于本次新增分配。商品至少保留一个销售店铺。仅显示你有权限查看的店铺。
                            </p>
                            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                                <div className="relative">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                    <input
                                        value={search}
                                        aria-label="搜索商品"
                                        disabled={busy}
                                        onChange={event => {
                                            setSearch(event.target.value);
                                            resetSelection();
                                        }}
                                        placeholder="按名称搜索（最多返回 100 条）"
                                        className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
                                    />
                                </div>
                                <select
                                    aria-label="按目标店铺分配状态筛选"
                                    value={assignmentFilter}
                                    disabled={busy || !target || !ready}
                                    onChange={event => {
                                        setAssignmentFilter(event.target.value);
                                        resetSelection();
                                    }}
                                    className={inputClass}
                                >
                                    <option value="all">全部分配状态</option>
                                    <option value="assigned">已在目标店铺</option>
                                    <option value="unassigned">未在目标店铺</option>
                                </select>
                            </div>
                            {products.loading && !page ? (
                                <p className="p-8 text-center text-xs text-slate-500">正在读取商品…</p>
                            ) : products.error ? (
                                <Notice tone="error" message="商品店铺分配读取失败，请关闭后重试" />
                            ) : (
                                <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                                    <label className="flex items-center gap-3 border-b bg-slate-50 p-3 text-xs font-bold">
                                        <input
                                            type="checkbox"
                                            checked={
                                                Boolean(selectable.length) &&
                                                selectable.every(item => selectedIds.includes(item.id))
                                            }
                                            disabled={busy || !ready || !selectable.length}
                                            onChange={event =>
                                                setSelectedIds(
                                                    event.target.checked
                                                        ? selectable.map(item => item.id)
                                                        : [],
                                                )
                                            }
                                        />
                                        选择当前可{mode === 'assign' ? '分配' : '移除'}商品 (
                                        {selectable.length})
                                    </label>
                                    {!items.length && (
                                        <p className="p-8 text-center text-xs text-slate-500">
                                            没有符合条件的商品
                                        </p>
                                    )}
                                    {items.map(item => (
                                        <label
                                            key={item.id}
                                            className="flex items-start gap-3 border-b border-slate-100 p-3 text-xs last:border-0"
                                        >
                                            <input
                                                type="checkbox"
                                                className="mt-1 shrink-0"
                                                aria-label={`选择商品：${item.name}`}
                                                disabled={busy || !ready || !eligible(item)}
                                                checked={selectedIds.includes(item.id)}
                                                onChange={event =>
                                                    setSelectedIds(current =>
                                                        event.target.checked
                                                            ? [...current, item.id]
                                                            : current.filter(id => id !== item.id),
                                                    )
                                                }
                                            />
                                            <span className="min-w-0 flex-1 space-y-2">
                                                <span className="flex flex-wrap items-start justify-between gap-2">
                                                    <strong className="break-words">{item.name}</strong>
                                                    <span
                                                        className={`rounded px-2 py-0.5 ${target && belongsToTarget(item) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                                                    >
                                                        {!target
                                                            ? '未选择目标店铺'
                                                            : belongsToTarget(item)
                                                              ? '已在目标店铺'
                                                              : '未在目标店铺'}
                                                    </span>
                                                </span>
                                                <span className="flex flex-wrap items-center gap-1.5 text-slate-500">
                                                    <span>当前所在店铺：</span>
                                                    {item.channels.map(channel => (
                                                        <span
                                                            key={channel.id}
                                                            className="rounded border border-slate-200 px-1.5 py-0.5"
                                                        >
                                                            {getChannelDisplayName(channel.code)}
                                                        </span>
                                                    ))}
                                                    {!item.channels.length && (
                                                        <span>暂无可查看的店铺关联</span>
                                                    )}
                                                </span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            )}
                            {page && (
                                <p className="text-xs text-slate-500">
                                    当前显示 {items.length} 个商品，可{mode === 'assign' ? '分配' : '移除'}{' '}
                                    {selectable.length} 个
                                    {page.totalItems > 100
                                        ? `；匹配共 ${page.totalItems} 个，请按名称缩小范围`
                                        : ''}
                                    {!ready && !products.error ? ' · 正在刷新分配状态…' : ''}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center justify-between border-t p-5">
                            <span className="text-xs text-slate-500">已选 {selected.length} 个商品</span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    disabled={busy}
                                    className={secondaryButton}
                                >
                                    取消
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void submit()}
                                    disabled={busy || !ready || !selected.length || !target}
                                    className={primaryButton}
                                >
                                    {busy ? '后端处理中…' : mode === 'assign' ? '确认分配' : '确认移除'}
                                </button>
                            </div>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </>
    );
}
function Notice({ tone, message }: { tone: 'success' | 'error' | 'info'; message: string }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : tone === 'info' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
            {message}
        </div>
    );
}
const labelClass = 'text-xs font-bold text-slate-600';
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal';
const primaryButton = 'rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40';
const secondaryButton =
    'rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40';
