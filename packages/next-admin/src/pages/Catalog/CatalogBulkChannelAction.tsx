import { useMutation } from '@apollo/client/react';
import { Layers3, Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useCatalogReferences } from '../../hooks/use-catalog-references';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';

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
    const selectedReferences = useCatalogReferences(selectedIds, 'catalogProductChannelAssignments', open);
    const target = page?.channels.find(channel => channel.id === channelId);
    const ready = !products.loading && !products.error && deferredSearch === search.trim();
    const belongsToTarget = (item: ProductChannelAssignment) =>
        item.channels.some(channel => channel.id === channelId);
    const eligible = (item: ProductChannelAssignment) =>
        Boolean(target) &&
        (mode !== 'assign' || item.enabled) &&
        !(mode === 'remove' && item.channels.length <= 1) &&
        (mode === 'assign' ? !belongsToTarget(item) : belongsToTarget(item));
    const items = (page?.items ?? []).filter(
        item =>
            assignmentFilter === 'all' ||
            !target ||
            (assignmentFilter === 'assigned' ? belongsToTarget(item) : !belongsToTarget(item)),
    );
    const selectable = items.filter(eligible);
    const selected = selectedReferences.references.flatMap(reference =>
        reference.entity &&
        reference.state !== 'unknown' &&
        eligible(reference.entity as ProductChannelAssignment)
            ? [reference.entity as ProductChannelAssignment]
            : [],
    );
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
            const latest = await selectedReferences.recheck();
            if (latest.some(reference => reference.state === 'unknown'))
                throw new Error('无法核对已选商品，原选择已保留，请重试');
            const ids = latest.flatMap(reference =>
                reference.entity && eligible(reference.entity as ProductChannelAssignment)
                    ? [reference.id]
                    : [],
            );
            const skipped = selectedIds.length - ids.length;
            if (!ids.length) {
                setNotice('分配状态已变化，本次无需操作，原选择已保留');
                return;
            }
            let acceptedIds: string[];
            if (mode === 'assign') {
                const factor = Number(priceFactor);
                if (!Number.isFinite(factor) || factor <= 0) throw new Error('价格系数必须大于 0');
                const receipt = await assign({
                    variables: { input: { productIds: ids, channelId, priceFactor: factor } },
                    errorPolicy: 'all',
                });
                acceptedIds =
                    receipt.data?.assignProductsToChannel.flatMap(item =>
                        item?.id && ids.includes(item.id) ? [item.id] : [],
                    ) ?? [];
            } else {
                const receipt = await remove({
                    variables: { input: { productIds: ids, channelId } },
                    errorPolicy: 'all',
                });
                acceptedIds =
                    receipt.data?.removeProductsFromChannel.flatMap(item =>
                        item?.id && ids.includes(item.id) ? [item.id] : [],
                    ) ?? [];
            }
            const accepted = new Set(acceptedIds);
            const remaining = selectedIds.filter(id => !accepted.has(id));
            setNotice(
                `已${mode === 'assign' ? '分配到' : '从'}「${getChannelDisplayName(target)}」${mode === 'remove' ? '移除' : ''} ${acceptedIds.length} 个商品${skipped ? `，跳过 ${skipped} 个状态已变化的商品` : ''}`,
            );
            if (ids.some(id => !accepted.has(id)))
                setError('部分商品未确认成功，已保留待处理选择；再次操作只提交剩余商品。');
            await refreshAfterAdminWrite(async () => {
                const verified = await selectedReferences.recheck();
                if (
                    !acceptedIds.every(id => {
                        const reference = verified.find(item => item.id === id);
                        if (!reference?.entity || reference.state === 'unknown') return false;
                        return mode === 'assign'
                            ? belongsToTarget(reference.entity as ProductChannelAssignment)
                            : !belongsToTarget(reference.entity as ProductChannelAssignment);
                    })
                )
                    throw new Error('分配状态读取未确认');
                await products.refetch();
            }, setError);
            setSelectedIds(remaining);
        } catch (cause) {
            setError(toUserFacingError(cause, '商品批量店铺操作失败'));
            await products.refetch().catch(() => undefined);
        } finally {
            setPending(false);
        }
    };
    return (
        <>
            <AdminButton
                type="button"
                onClick={() => {
                    resetSelection();
                    setOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
                <Layers3 className="h-4 w-4" />
                批量店铺
            </AdminButton>
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
                                    <FeatureHelpButton
                                        topic="catalog.products"
                                        title="商品批量店铺操作"
                                        description={
                                            '同一商品可分配到多个店铺。先查看现有分配，再选择需要新增或移除的商品。'
                                        }
                                    />
                                </h2>
                            </div>
                            <AdminButton
                                type="button"
                                onClick={() => setOpen(false)}
                                disabled={busy}
                                aria-label="关闭"
                            >
                                <X className="h-4 w-4" />
                            </AdminButton>
                        </div>
                        <div className="space-y-4 overflow-y-auto p-5">
                            {notice && <Notice tone="success" message={notice} />}
                            {error && <Notice tone="error" message={error} />}
                            <div className="grid gap-3 sm:grid-cols-3">
                                <AdminField className={labelClass} label="操作">
                                    <AdminSelect
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
                                    </AdminSelect>
                                </AdminField>
                                <AdminField className={labelClass} label="目标店铺">
                                    <AdminSelect
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
                                                {getChannelDisplayName(channel)}
                                            </option>
                                        ))}
                                    </AdminSelect>
                                </AdminField>
                                {mode === 'assign' && (
                                    <AdminField className={labelClass} label="价格系数">
                                        <AdminInput
                                            type="number"
                                            min="0.0001"
                                            step="0.01"
                                            value={priceFactor}
                                            disabled={busy}
                                            onChange={event => setPriceFactor(event.target.value)}
                                            className={inputClass}
                                        />
                                    </AdminField>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">
                                已分配的商品会自动跳过，价格系数仅用于本次新增分配。商品至少保留一个销售店铺。仅显示你有权限查看的店铺。
                            </p>
                            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                                <div className="relative">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                    <AdminInput
                                        value={search}
                                        aria-label="搜索商品"
                                        disabled={busy}
                                        onChange={event => {
                                            setSearch(event.target.value);
                                        }}
                                        placeholder="按名称搜索（最多返回 100 条）"
                                        className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
                                    />
                                </div>
                                <AdminSelect
                                    aria-label="按目标店铺分配状态筛选"
                                    value={assignmentFilter}
                                    disabled={busy || !target || !ready}
                                    onChange={event => {
                                        setAssignmentFilter(event.target.value);
                                    }}
                                    className={inputClass}
                                >
                                    <option value="all">全部分配状态</option>
                                    <option value="assigned">已在目标店铺</option>
                                    <option value="unassigned">未在目标店铺</option>
                                </AdminSelect>
                            </div>
                            {products.loading && !page ? (
                                <p className="p-8 text-center text-xs text-slate-500">正在读取商品…</p>
                            ) : products.error && !products.data ? (
                                <Notice tone="error" message="商品店铺分配读取失败，请关闭后重试" />
                            ) : (
                                <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                                    <label className="flex items-center gap-3 border-b bg-slate-50 p-3 text-xs font-bold">
                                        <AdminInput
                                            type="checkbox"
                                            checked={
                                                Boolean(selectable.length) &&
                                                selectable.every(item => selectedIds.includes(item.id))
                                            }
                                            disabled={busy || !ready || !selectable.length}
                                            onChange={event =>
                                                setSelectedIds(current =>
                                                    event.target.checked
                                                        ? [
                                                              ...new Set([
                                                                  ...current,
                                                                  ...selectable.map(item => item.id),
                                                              ]),
                                                          ]
                                                        : current.filter(
                                                              id => !selectable.some(item => item.id === id),
                                                          ),
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
                                            <AdminInput
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
                                                            {getChannelDisplayName(channel)}
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
                            <span className="text-xs text-slate-500">
                                已选 {selectedIds.length} 个商品，有效 {selected.length} 个，暂不可用{' '}
                                {selectedReferences.unavailable.length} 个，待核对{' '}
                                {selectedReferences.unknown.length} 个
                            </span>
                            {selectedReferences.error ? (
                                <AdminButton
                                    type="button"
                                    disabled={busy || selectedReferences.loading}
                                    onClick={() => void selectedReferences.refetch()}
                                >
                                    重试核对
                                </AdminButton>
                            ) : null}
                            <div className="flex gap-2">
                                <AdminButton
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    disabled={busy}
                                    className={secondaryButton}
                                >
                                    取消
                                </AdminButton>
                                <AdminButton
                                    type="button"
                                    onClick={() => void submit()}
                                    disabled={busy || !ready || !selected.length || !target}
                                    className={primaryButton}
                                >
                                    {busy ? '后端处理中…' : mode === 'assign' ? '确认分配' : '确认移除'}
                                </AdminButton>
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
