import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    Check,
    CheckCircle2,
    Layers3,
    Loader2,
    Package,
    Plus,
    RefreshCw,
    Search,
    Store,
    X,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import {
    GET_CATALOG_CHANNEL_ASSIGNMENTS,
    type AssignmentChannel,
    type CatalogChannelAssignmentsData,
    type ProductChannelAssignment,
} from '../../graphql/catalog-channel-assignments.graphql';
import {
    ASSIGN_PRODUCTS_TO_CHANNEL,
    REMOVE_PRODUCTS_FROM_CHANNEL,
} from '../../graphql/catalog.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { CatalogBulkChannelBar } from './CatalogBulkChannelBar';

type FilterTab = 'all' | 'unassigned' | 'multi' | string;

export function StoreAllocationMatrixModule() {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearch = useDeferredValue(searchTerm.trim());
    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
    const [updatingCell, setUpdatingCell] = useState<{ productId: string; channelId: string } | null>(
        null,
    );
    const [notification, setNotification] = useState<{
        type: 'success' | 'error' | 'warning';
        message: string;
    } | null>(null);

    const { data, loading, error, refetch } = useQuery<CatalogChannelAssignmentsData>(
        GET_CATALOG_CHANNEL_ASSIGNMENTS,
        {
            variables: {
                options: {
                    take: 100,
                    sort: { updatedAt: 'DESC', id: 'DESC' },
                    ...(deferredSearch ? { filter: { name: { contains: deferredSearch } } } : {}),
                },
            },
            fetchPolicy: 'cache-and-network',
            notifyOnNetworkStatusChange: true,
        },
    );

    const [assignMutation, { loading: assigning }] = useMutation(ASSIGN_PRODUCTS_TO_CHANNEL);
    const [removeMutation, { loading: removing }] = useMutation(REMOVE_PRODUCTS_FROM_CHANNEL);

    const showNotice = (
        message: string,
        type: 'success' | 'error' | 'warning' = 'success',
    ) => {
        setNotification({ type, message });
        const timer = window.setTimeout(() => {
            setNotification(prev => (prev?.message === message ? null : prev));
        }, 4000);
        return () => window.clearTimeout(timer);
    };

    const channels: AssignmentChannel[] = useMemo(
        () => data?.catalogProductChannelAssignments.channels ?? [],
        [data?.catalogProductChannelAssignments.channels],
    );
    const allProducts: ProductChannelAssignment[] = useMemo(
        () => data?.catalogProductChannelAssignments.items ?? [],
        [data?.catalogProductChannelAssignments.items],
    );

    // Filter products based on active tab
    const filteredProducts = useMemo(() => {
        return allProducts.filter(product => {
            if (activeTab === 'all') return true;
            if (activeTab === 'unassigned') {
                // Products that are only in the default channel and have not been distributed to any branch
                return product.channels.length <= 1 && product.channels.some(c => c.isDefault);
            }
            if (activeTab === 'multi') {
                return product.channels.length > 1;
            }
            // Filter by specific channel ID
            return product.channels.some(c => c.id === activeTab);
        });
    }, [allProducts, activeTab]);

    // Calculate metrics
    const metrics = useMemo(() => {
        const total = allProducts.length;
        const unassigned = allProducts.filter(
            p => p.channels.length <= 1 && p.channels.some(c => c.isDefault),
        ).length;
        const channelCounts = new Map<string, number>();
        for (const ch of channels) {
            channelCounts.set(ch.id, 0);
        }
        for (const p of allProducts) {
            for (const ch of p.channels) {
                channelCounts.set(ch.id, (channelCounts.get(ch.id) ?? 0) + 1);
            }
        }
        return { total, unassigned, channelCounts };
    }, [allProducts, channels]);

    // Handle single cell toggle (assign / remove)
    const handleToggleChannel = async (product: ProductChannelAssignment, channel: AssignmentChannel) => {
        const hasChannel = product.channels.some(c => c.id === channel.id);
        const channelName = getChannelDisplayName(channel.code);

        if (hasChannel) {
            // Check if this is the product's only channel
            if (product.channels.length <= 1) {
                showNotice(
                    `商品《${product.name}》当前仅属于「${channelName}」，商品必须至少保留在一个店铺中，无法移除唯一归属店铺。`,
                    'warning',
                );
                return;
            }

            setUpdatingCell({ productId: product.id, channelId: channel.id });
            try {
                await removeMutation({
                    variables: {
                        input: {
                            productIds: [product.id],
                            channelId: channel.id,
                        },
                    },
                });
                showNotice(`已将商品《${product.name}》从「${channelName}」下架`);
                void refetch();
            } catch (err) {
                showNotice(toUserFacingError(err, '从店铺下架失败'), 'error');
            } finally {
                setUpdatingCell(null);
            }
        } else {
            setUpdatingCell({ productId: product.id, channelId: channel.id });
            try {
                await assignMutation({
                    variables: {
                        input: {
                            productIds: [product.id],
                            channelId: channel.id,
                            priceFactor: 1.0,
                        },
                    },
                });
                showNotice(`已将商品《${product.name}》上架至「${channelName}」`);
                void refetch();
            } catch (err) {
                showNotice(toUserFacingError(err, '上架到店铺失败'), 'error');
            } finally {
                setUpdatingCell(null);
            }
        }
    };

    // Bulk actions
    const handleBulkAssign = async (targetChannelId: string, priceFactor: number) => {
        if (!selectedProductIds.length) return;
        const targetChannel = channels.find(c => c.id === targetChannelId);
        const targetName = targetChannel ? getChannelDisplayName(targetChannel.code) : '';

        try {
            await assignMutation({
                variables: {
                    input: {
                        productIds: selectedProductIds,
                        channelId: targetChannelId,
                        priceFactor,
                    },
                },
            });
            showNotice(`已将选中的 ${selectedProductIds.length} 个商品成功上架至「${targetName}」`);
            setSelectedProductIds([]);
            void refetch();
        } catch (err) {
            showNotice(toUserFacingError(err, '批量上架失败'), 'error');
        }
    };

    const handleBulkRemove = async (targetChannelId: string) => {
        if (!selectedProductIds.length) return;
        const targetChannel = channels.find(c => c.id === targetChannelId);
        const targetName = targetChannel ? getChannelDisplayName(targetChannel.code) : '';

        // Pre-filter: Do not attempt to remove products where this is their only channel
        const eligibleIds: string[] = [];
        let skippedCount = 0;

        for (const id of selectedProductIds) {
            const prod = allProducts.find(p => p.id === id);
            if (prod && prod.channels.some(c => c.id === targetChannelId)) {
                if (prod.channels.length > 1) {
                    eligibleIds.push(id);
                } else {
                    skippedCount++;
                }
            }
        }

        if (eligibleIds.length === 0) {
            showNotice(
                skippedCount > 0
                    ? `所选商品中仅属于「${targetName}」，无法从其唯一店铺移除。`
                    : `所选商品未在上架状态，无需下架。`,
                'warning',
            );
            return;
        }

        try {
            await removeMutation({
                variables: {
                    input: {
                        productIds: eligibleIds,
                        channelId: targetChannelId,
                    },
                },
            });
            showNotice(
                `已从「${targetName}」下架 ${eligibleIds.length} 个商品${skippedCount > 0 ? `（自动跳过 ${skippedCount} 个唯一归属该店的商品）` : ''}`,
            );
            setSelectedProductIds([]);
            void refetch();
        } catch (err) {
            showNotice(toUserFacingError(err, '批量下架失败'), 'error');
        }
    };

    // Selection helpers
    const allFilteredSelected =
        filteredProducts.length > 0 &&
        filteredProducts.every(p => selectedProductIds.includes(p.id));

    const isIndeterminate =
        filteredProducts.some(p => selectedProductIds.includes(p.id)) && !allFilteredSelected;

    const toggleSelectAll = () => {
        if (allFilteredSelected) {
            setSelectedProductIds(prev =>
                prev.filter(id => !filteredProducts.some(p => p.id === id)),
            );
        } else {
            const combined = new Set([...selectedProductIds, ...filteredProducts.map(p => p.id)]);
            setSelectedProductIds(Array.from(combined));
        }
    };

    const toggleSelectProduct = (productId: string) => {
        setSelectedProductIds(prev =>
            prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId],
        );
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            {/* Header */}
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => navigate('/catalog/list')}
                        aria-label="返回商品管理"
                        className="rounded-lg border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Layers3 className="h-5 w-5 text-blue-600" />
                            商品多店铺分配中心
                            <FeatureHelpButton topic="catalog.products" title="商品多店铺分配中心" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            集中管理商品在各个店铺/渠道的上架状态，直观对比分发矩阵并一键批量调配
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                        type="button"
                        onClick={() => void refetch()}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50 cursor-pointer"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
                        <span>刷新矩阵</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/catalog/list')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
                    >
                        <Package className="h-3.5 w-3.5 text-slate-500" />
                        <span>商品主列表</span>
                    </button>
                </div>
            </div>

            {/* Notification alert */}
            {notification && (
                <div className="px-5 pt-4 sm:px-8">
                    <div
                        role="status"
                        className={`flex items-center gap-2 rounded-xl border p-3.5 text-xs font-medium animate-fadeIn ${
                            notification.type === 'success'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : notification.type === 'warning'
                                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                                  : 'border-rose-200 bg-rose-50 text-rose-800'
                        }`}
                    >
                        {notification.type === 'success' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : notification.type === 'warning' ? (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                        ) : (
                            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                        )}
                        <span>{notification.message}</span>
                        <button
                            type="button"
                            onClick={() => setNotification(null)}
                            className="ml-auto text-slate-400 hover:text-slate-600"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="w-full max-w-none flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                    {/* Card 1: Total Products */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500">商品总数</span>
                            <Package className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="mt-2 text-2xl font-extrabold text-slate-900">
                            {metrics.total}
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">主库当前可供分配商品</p>
                    </div>

                    {/* Card 2: Unassigned Warning Card */}
                    <div
                        onClick={() => setActiveTab('unassigned')}
                        className={`cursor-pointer rounded-xl border p-4 shadow-2xs transition-all ${
                            activeTab === 'unassigned'
                                ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-400'
                                : 'border-amber-200 bg-amber-50 hover:border-amber-400'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-800">仅默认店铺 (未分发)</span>
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                        </div>
                        <div className="mt-2 text-2xl font-extrabold text-amber-900">
                            {metrics.unassigned}
                        </div>
                        <p className="mt-1 text-[11px] text-amber-700">尚未分配到任何独立分店</p>
                    </div>

                    {/* Store Cards */}
                    {channels.map(channel => {
                        const count = metrics.channelCounts.get(channel.id) ?? 0;
                        const percent = metrics.total > 0 ? Math.round((count / metrics.total) * 100) : 0;
                        const isCurrentActive = activeTab === channel.id;

                        return (
                            <div
                                key={channel.id}
                                onClick={() => setActiveTab(isCurrentActive ? 'all' : channel.id)}
                                className={`cursor-pointer rounded-xl border p-4 shadow-2xs transition-all ${
                                    isCurrentActive
                                        ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-400'
                                        : 'border-slate-200 bg-white hover:border-blue-300'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="truncate text-xs font-bold text-slate-700" title={getChannelDisplayName(channel.code)}>
                                        {getChannelDisplayName(channel.code)}
                                    </span>
                                    <Store className="h-4 w-4 text-slate-400 shrink-0" />
                                </div>
                                <div className="mt-2 flex items-baseline justify-between">
                                    <span className="text-2xl font-extrabold text-slate-900">{count}</span>
                                    <span className="text-[11px] font-semibold text-slate-500">{percent}% 上架率</span>
                                </div>
                                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            channel.isDefault ? 'bg-blue-500' : 'bg-emerald-500'
                                        }`}
                                        style={{ width: `${percent}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Table Container */}
                <div className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                    {/* Toolbar */}
                    <div className="space-y-3 border-b border-slate-200 bg-slate-50/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            {/* Filter Tabs */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('all')}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        activeTab === 'all'
                                            ? 'bg-blue-600 text-white shadow-2xs'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    全部商品 ({allProducts.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('unassigned')}
                                    className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        activeTab === 'unassigned'
                                            ? 'bg-amber-600 text-white shadow-2xs'
                                            : 'border border-amber-200 bg-amber-50/70 text-amber-800 hover:bg-slate-100'
                                    }`}
                                >
                                    <AlertTriangle className="h-3 w-3" />
                                    仅默认店铺 (未分发: {metrics.unassigned})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('multi')}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        activeTab === 'multi'
                                            ? 'bg-indigo-600 text-white shadow-2xs'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    多店铺通用
                                </button>
                            </div>

                            {/* Search box */}
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <SearchInput
                                    type="search"
                                    autoComplete="off"
                                    value={searchTerm}
                                    onValueChange={setSearchTerm}
                                    aria-label="在矩阵中搜索商品"
                                    placeholder="搜索商品名称…"
                                    className="w-64 rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchTerm('')}
                                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                                        aria-label="清空搜索"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Bulk Action Toolbar (appears when products are selected) */}
                        {selectedProductIds.length > 0 && (
                            <CatalogBulkChannelBar
                                selectedCount={selectedProductIds.length}
                                channels={channels}
                                onAssign={handleBulkAssign}
                                onRemove={handleBulkRemove}
                                onClearSelection={() => setSelectedProductIds([])}
                                busy={assigning || removing}
                            />
                        )}
                    </div>

                    {/* Matrix Table */}
                    <div className="relative flex-1 overflow-x-auto">
                        {loading && !data && (
                            <div className="space-y-4 p-8">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div
                                        key={i}
                                        className="flex h-12 animate-pulse items-center gap-4 rounded-lg bg-slate-100 px-4"
                                    >
                                        <div className="h-6 w-6 rounded bg-slate-200 shrink-0" />
                                        <div className="h-4 w-48 rounded bg-slate-200" />
                                        <div className="h-4 w-28 rounded bg-slate-200 ml-auto" />
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Error state */}
                        {error && (
                            <div className="m-6 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                                    <span>商品分配数据读取失败，请检查网络或权限。</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void refetch()}
                                    className="rounded bg-rose-600 px-3 py-1 font-bold text-white transition-colors hover:bg-rose-700"
                                >
                                    重试
                                </button>
                            </div>
                        )}

                        {/* Empty state */}
                        {!loading && !error && filteredProducts.length === 0 && (
                            <div className="flex flex-col items-center justify-center space-y-3 p-16 text-center">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                                    <Package className="h-6 w-6" />
                                </div>
                                <div className="text-sm font-bold text-slate-700">暂无匹配的商品</div>
                                <p className="max-w-xs text-xs text-slate-400">
                                    当前筛选条件或搜索关键词下未找到商品分配记录。
                                </p>
                            </div>
                        )}

                        {/* Table */}
                        {filteredProducts.length > 0 && (
                            <table className="w-full border-collapse text-left text-xs">
                                <thead>
                                    <tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50/80 font-bold text-slate-600">
                                        {/* Checkbox */}
                                        <th
                                            scope="col"
                                            className="sticky left-0 z-20 w-10 bg-slate-50 px-3 py-3"
                                        >
                                            <input
                                                type="checkbox"
                                                aria-label="全选本页商品"
                                                checked={allFilteredSelected}
                                                ref={el => {
                                                    if (el) el.indeterminate = isIndeterminate;
                                                }}
                                                onChange={toggleSelectAll}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                            />
                                        </th>

                                        {/* Product info */}
                                        <th
                                            scope="col"
                                            className="sticky left-10 z-20 min-w-64 max-w-80 bg-slate-50 px-3 py-3"
                                        >
                                            商品信息
                                        </th>

                                        {/* Product Status */}
                                        <th scope="col" className="w-24 px-3 py-3">
                                            商品状态
                                        </th>

                                        {/* Store distribution columns */}
                                        {channels.map(channel => (
                                            <th
                                                key={channel.id}
                                                scope="col"
                                                className="min-w-44 px-3 py-3 text-center border-l border-slate-200/80"
                                            >
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <span className="font-extrabold text-slate-800">
                                                        {getChannelDisplayName(channel.code)}
                                                    </span>
                                                    <span className="font-mono text-[10px] text-slate-400">
                                                        {channel.code}
                                                        {channel.isDefault ? ' (主店)' : ''}
                                                    </span>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                    {filteredProducts.map(product => {
                                        const isSelected = selectedProductIds.includes(product.id);
                                        const isUnassignedOnly =
                                            product.channels.length <= 1 &&
                                            product.channels.some(c => c.isDefault);

                                        return (
                                            <tr
                                                key={product.id}
                                                className={`group h-[56px] transition-colors ${
                                                    isSelected
                                                        ? 'bg-blue-50/40 hover:bg-blue-50/50'
                                                        : 'hover:bg-slate-50/80'
                                                }`}
                                            >
                                                {/* Checkbox */}
                                                <td className="sticky left-0 z-10 h-[56px] w-10 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`选择商品 ${product.name}`}
                                                        checked={isSelected}
                                                        onChange={() => toggleSelectProduct(product.id)}
                                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                </td>

                                                {/* Product Info */}
                                                <td className="sticky left-10 z-10 h-[56px] min-w-64 max-w-80 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="flex-1 min-w-0">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    navigate(`/catalog/products/${product.id}`)
                                                                }
                                                                className="block truncate text-left font-bold text-slate-900 hover:text-blue-600 cursor-pointer"
                                                                title={product.name}
                                                            >
                                                                {product.name}
                                                            </button>
                                                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                                                                {isUnassignedOnly ? (
                                                                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.2 text-[10px] font-bold text-amber-700 border border-amber-200">
                                                                        <AlertTriangle className="h-2.5 w-2.5" />
                                                                        未分发到分店
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] text-slate-400">
                                                                        已上架 {product.channels.length} 个店铺
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Product Status */}
                                                <td className="h-[56px] whitespace-nowrap px-3 py-0">
                                                    {product.enabled ? (
                                                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                                            <CheckCircle2 className="h-3 w-3" />
                                                            已上架
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                                            <Package className="h-3 w-3" />
                                                            仓库中
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Store Matrix Cells */}
                                                {channels.map(channel => {
                                                    const isAssigned = product.channels.some(
                                                        c => c.id === channel.id,
                                                    );
                                                    const isCellUpdating =
                                                        updatingCell?.productId === product.id &&
                                                        updatingCell?.channelId === channel.id;

                                                    return (
                                                        <td
                                                            key={channel.id}
                                                            className="h-[56px] whitespace-nowrap px-3 py-0 text-center border-l border-slate-100"
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    void handleToggleChannel(product, channel)
                                                                }
                                                                disabled={isCellUpdating || assigning || removing}
                                                                className={`group/btn inline-flex items-center justify-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-all shadow-2xs cursor-pointer ${
                                                                    isAssigned
                                                                        ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700'
                                                                        : 'border border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                                                                } disabled:cursor-not-allowed disabled:opacity-50`}
                                                                title={
                                                                    isAssigned
                                                                        ? `点击从「${getChannelDisplayName(channel.code)}」下架`
                                                                        : `点击上架到「${getChannelDisplayName(channel.code)}」`
                                                                }
                                                            >
                                                                {isCellUpdating ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin text-slate-600" />
                                                                ) : isAssigned ? (
                                                                    <>
                                                                        <Check className="h-3 w-3 group-hover/btn:hidden text-emerald-600" />
                                                                        <span className="group-hover/btn:hidden">已在售</span>
                                                                        <X className="hidden h-3 w-3 group-hover/btn:inline text-rose-600" />
                                                                        <span className="hidden group-hover/btn:inline">下架</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Plus className="h-3 w-3 text-slate-400 group-hover/btn:text-blue-600" />
                                                                        <span>未上架</span>
                                                                    </>
                                                                )}
                                                            </button>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
