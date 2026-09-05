import { useMutation, useQuery } from '@apollo/client/react';
import { Layers3, Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import {
    ASSIGN_PRODUCTS_TO_CHANNEL,
    GET_CATALOG_CHANNELS,
    GET_PRODUCTS,
    REMOVE_PRODUCTS_FROM_CHANNEL,
} from '../../graphql/catalog.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';

interface ProductResult {
    products: {
        items: Array<{ id: string; name: string; enabled: boolean; channels?: Array<{ id: string }> }>;
        totalItems: number;
    };
}
interface ChannelResult {
    activeChannel: { id: string };
    channels: { items: Array<{ id: string; code: string }>; totalItems: number };
}

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
    const products = useQuery<ProductResult>(GET_PRODUCTS, {
        variables: {
            options: {
                take: 100,
                sort: { updatedAt: 'DESC' },
                ...(deferredSearch ? { filter: { name: { contains: deferredSearch } } } : {}),
            },
        },
        skip: !open,
        fetchPolicy: 'network-only',
    });
    const channels = useQuery<ChannelResult>(GET_CATALOG_CHANNELS, {
        variables: { options: { take: 100, sort: { code: 'ASC' } } },
        skip: !open,
    });
    const [assign, assignState] = useMutation<{ assignProductsToChannel: Array<{ id: string }> }>(
        ASSIGN_PRODUCTS_TO_CHANNEL,
    );
    const [remove, removeState] = useMutation<{
        removeProductsFromChannel: Array<{ id: string }>;
    }>(REMOVE_PRODUCTS_FROM_CHANNEL);
    const busy = assignState.loading || removeState.loading;
    const submit = async () => {
        setError('');
        setNotice('');
        try {
            if (!selectedIds.length) throw new Error('请至少选择一个商品');
            if (!channelId) throw new Error('请选择目标店铺');
            if (mode === 'assign') {
                const factor = Number(priceFactor);
                if (!Number.isFinite(factor) || factor <= 0) throw new Error('价格系数必须大于 0');
                const result = await assign({
                    variables: { input: { productIds: selectedIds, channelId, priceFactor: factor } },
                });
                if ((result.data?.assignProductsToChannel.length ?? 0) !== selectedIds.length)
                    throw new Error('后端未返回所有已分配商品');
            } else {
                const result = await remove({ variables: { input: { productIds: selectedIds, channelId } } });
                if ((result.data?.removeProductsFromChannel.length ?? 0) !== selectedIds.length)
                    throw new Error('后端未返回所有已移除商品');
            }
            setNotice(`已${mode === 'assign' ? '分配' : '移除'} ${selectedIds.length} 个商品`);
            setSelectedIds([]);
            await products.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '商品批量店铺操作失败'));
        }
    };
    const items = products.data?.products.items ?? [];
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
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
                                <h2 className="text-base font-bold">商品批量店铺操作</h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    将多个商品分配到目标 Channel 或从中移除；价格系数只在分配时应用。
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
                                        value={mode}
                                        onChange={event => setMode(event.target.value as 'assign' | 'remove')}
                                        className={inputClass}
                                    >
                                        <option value="assign">分配到店铺</option>
                                        <option value="remove">从店铺移除</option>
                                    </select>
                                </label>
                                <label className={labelClass}>
                                    目标店铺
                                    <select
                                        value={channelId}
                                        onChange={event => setChannelId(event.target.value)}
                                        className={inputClass}
                                    >
                                        <option value="">请选择</option>
                                        {channels.data?.channels.items.map(channel => (
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
                                            onChange={event => setPriceFactor(event.target.value)}
                                            className={inputClass}
                                        />
                                    </label>
                                )}
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <input
                                    value={search}
                                    onChange={event => setSearch(event.target.value)}
                                    placeholder="按名称搜索（最多返回 100 条）"
                                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
                                />
                            </div>
                            {products.loading && !products.data ? (
                                <p className="p-8 text-center text-xs text-slate-500">正在读取商品…</p>
                            ) : products.error ? (
                                <Notice tone="error" message="商品读取失败" />
                            ) : (
                                <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                                    <label className="flex items-center gap-3 border-b bg-slate-50 p-3 text-xs font-bold">
                                        <input
                                            type="checkbox"
                                            checked={
                                                Boolean(items.length) &&
                                                items.every(item => selectedIds.includes(item.id))
                                            }
                                            onChange={event =>
                                                setSelectedIds(
                                                    event.target.checked ? items.map(item => item.id) : [],
                                                )
                                            }
                                        />
                                        选择当前结果 ({items.length})
                                    </label>
                                    {items.map(item => (
                                        <label
                                            key={item.id}
                                            className="flex items-center justify-between gap-3 border-b border-slate-100 p-3 text-xs last:border-0"
                                        >
                                            <span className="flex items-center gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.includes(item.id)}
                                                    onChange={event =>
                                                        setSelectedIds(current =>
                                                            event.target.checked
                                                                ? [...current, item.id]
                                                                : current.filter(id => id !== item.id),
                                                        )
                                                    }
                                                />
                                                <strong>{item.name}</strong>
                                            </span>
                                            <small className="text-slate-500">
                                                {item.enabled ? '上架' : '下架'}
                                            </small>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-between border-t p-5">
                            <span className="text-xs text-slate-500">已选 {selectedIds.length} 个商品</span>
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
                                    disabled={busy || !selectedIds.length || !channelId}
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
function Notice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
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
