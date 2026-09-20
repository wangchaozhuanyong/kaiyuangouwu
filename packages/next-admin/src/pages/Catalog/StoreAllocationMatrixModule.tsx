import { useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Layers3,
    Package,
    RefreshCw,
    Search,
    Store,
    X,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAdminReturn } from '../../hooks/use-admin-return';

import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import {
    GET_CATALOG_CHANNEL_ASSIGNMENTS,
    type AssignmentChannel,
    type CatalogChannelAssignmentsData,
    type ProductChannelAssignment,
} from '../../graphql/catalog-channel-assignments.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';

type FilterTab = 'all' | 'unassigned' | 'multi' | string;
const PAGE_SIZE = 50;

export function StoreAllocationMatrixModule() {
    const location = useLocation();
    const navigate = useNavigate();
    const { returnToList } = useAdminReturn('/catalog/list');
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearch = useDeferredValue(searchTerm.trim());
    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [page, setPage] = useState(0);

    const changeActiveTab = (nextTab: FilterTab) => {
        setActiveTab(nextTab);
        setPage(0);
    };

    const changeSearchTerm = (value: string) => {
        setSearchTerm(value);
        setPage(0);
    };

    const changePage = (nextPage: number) => {
        setPage(nextPage);
    };

    const assignmentFilter = useMemo(() => {
        if (activeTab === 'unassigned') return { mode: 'UNASSIGNED' };
        if (activeTab === 'multi') return { mode: 'MULTI' };
        if (activeTab !== 'all') return { mode: 'CHANNEL', channelId: activeTab };
        return { mode: 'ALL' };
    }, [activeTab]);

    const { data, loading, error, refetch } = useQuery<CatalogChannelAssignmentsData>(
        GET_CATALOG_CHANNEL_ASSIGNMENTS,
        {
            variables: {
                options: {
                    skip: page * PAGE_SIZE,
                    take: PAGE_SIZE,
                    sort: { updatedAt: 'DESC', id: 'DESC' },
                    ...(deferredSearch ? { filter: { name: { contains: deferredSearch } } } : {}),
                },
                assignmentFilter,
            },
            fetchPolicy: 'cache-and-network',
            notifyOnNetworkStatusChange: true,
        },
    );

    const channels: AssignmentChannel[] = useMemo(
        () => data?.catalogProductChannelAssignments.channels ?? [],
        [data?.catalogProductChannelAssignments.channels],
    );
    const allProducts: ProductChannelAssignment[] = useMemo(
        () => data?.catalogProductChannelAssignments.items ?? [],
        [data?.catalogProductChannelAssignments.items],
    );

    const filteredProducts = allProducts;

    // Calculate metrics
    const metrics = useMemo(() => {
        const summary = data?.catalogProductChannelAssignments.summary;
        return {
            total: summary?.totalItems ?? 0,
            unassigned: summary?.unassignedItems ?? 0,
            multi: summary?.multiChannelItems ?? 0,
            channelCounts: new Map(summary?.channelCounts.map(item => [item.channelId, item.count]) ?? []),
        };
    }, [data?.catalogProductChannelAssignments.summary]);
    const filteredTotal = data?.catalogProductChannelAssignments.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
    const scopeChannel = data?.catalogProductChannelAssignments.scopeChannel;

    return (
        <div className="flex h-full flex-col bg-slate-50">
            {/* Header */}
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={returnToList}
                        aria-label="返回商品管理"
                        className="rounded-lg border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Layers3 className="h-5 w-5 text-blue-600" />
                            商品店铺归属检查
                            <FeatureHelpButton topic="catalog.products" title="商品店铺归属检查" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            只读检查商品的唯一店铺归属。跨店共享已禁止，多店记录必须通过隔离修复处理。
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
                        onClick={returnToList}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
                    >
                        <Package className="h-3.5 w-3.5 text-slate-500" />
                        <span>商品主列表</span>
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="w-full max-w-none flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                    {/* Card 1: Total Products */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500">当前渠道可见商品</span>
                            <Package className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="mt-2 text-2xl font-extrabold text-slate-900">{metrics.total}</div>
                        <p className="mt-1 text-[11px] text-slate-400">
                            {scopeChannel ? getChannelDisplayName(scopeChannel.code) : '当前渠道'}统计范围
                        </p>
                    </div>

                    {/* Card 2: Unassigned Warning Card */}
                    <div
                        onClick={() => changeActiveTab('unassigned')}
                        className={`cursor-pointer rounded-xl border p-4 shadow-2xs transition-all ${
                            activeTab === 'unassigned'
                                ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-400'
                                : 'border-amber-200 bg-amber-50 hover:border-amber-400'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-800">平台归属异常</span>
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                        </div>
                        <div className="mt-2 text-2xl font-extrabold text-amber-900">
                            {metrics.unassigned}
                        </div>
                        <p className="mt-1 text-[11px] text-amber-700">经营商品不应留在平台管理店铺</p>
                    </div>

                    {/* Store Cards */}
                    {channels.map(channel => {
                        const count = metrics.channelCounts.get(channel.id) ?? 0;
                        const percent = metrics.total > 0 ? Math.round((count / metrics.total) * 100) : 0;
                        const isCurrentActive = activeTab === channel.id;

                        return (
                            <div
                                key={channel.id}
                                onClick={() => changeActiveTab(isCurrentActive ? 'all' : channel.id)}
                                className={`cursor-pointer rounded-xl border p-4 shadow-2xs transition-all ${
                                    isCurrentActive
                                        ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-400'
                                        : 'border-slate-200 bg-white hover:border-blue-300'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span
                                        className="truncate text-xs font-bold text-slate-700"
                                        title={getChannelDisplayName(channel.code)}
                                    >
                                        {getChannelDisplayName(channel.code)}
                                    </span>
                                    <Store className="h-4 w-4 text-slate-400 shrink-0" />
                                </div>
                                <div className="mt-2 flex items-baseline justify-between">
                                    <span className="text-2xl font-extrabold text-slate-900">{count}</span>
                                    <span className="text-[11px] font-semibold text-slate-500">
                                        {percent}% 上架率
                                    </span>
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
                                    onClick={() => changeActiveTab('all')}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        activeTab === 'all'
                                            ? 'bg-blue-600 text-white shadow-2xs'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    全部商品 ({metrics.total})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => changeActiveTab('unassigned')}
                                    className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        activeTab === 'unassigned'
                                            ? 'bg-amber-600 text-white shadow-2xs'
                                            : 'border border-amber-200 bg-amber-50/70 text-amber-800 hover:bg-slate-100'
                                    }`}
                                >
                                    <AlertTriangle className="h-3 w-3" />
                                    平台归属异常 ({metrics.unassigned})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => changeActiveTab('multi')}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        activeTab === 'multi'
                                            ? 'bg-indigo-600 text-white shadow-2xs'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    多店共享异常 ({metrics.multi})
                                </button>
                            </div>

                            {/* Search box */}
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <SearchInput
                                    type="search"
                                    autoComplete="off"
                                    value={searchTerm}
                                    onValueChange={changeSearchTerm}
                                    aria-label="在矩阵中搜索商品"
                                    placeholder="搜索商品名称…"
                                    className="w-64 rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => changeSearchTerm('')}
                                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                                        aria-label="清空搜索"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                            本页不再修改店铺关联；商品跨店必须创建独立副本，不得共享同一条商品、规格、分类或素材记录。
                        </div>
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
                                    <span>商品归属数据读取失败，请检查网络或权限。</span>
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
                                    当前筛选条件或搜索关键词下未找到商品归属记录。
                                </p>
                            </div>
                        )}

                        {/* Table */}
                        {filteredProducts.length > 0 && (
                            <table className="w-full border-collapse text-left text-xs">
                                <thead>
                                    <tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50/80 font-bold text-slate-600">
                                        {/* Product info */}
                                        <th
                                            scope="col"
                                            className="sticky left-0 z-20 min-w-64 max-w-80 bg-slate-50 px-3 py-3"
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
                                        const isUnassignedOnly =
                                            product.channels.length <= 1 &&
                                            product.channels.some(c => c.isDefault);

                                        return (
                                            <tr
                                                key={product.id}
                                                className="group h-[56px] transition-colors hover:bg-slate-50/80"
                                            >
                                                {/* Product Info */}
                                                <td className="sticky left-0 z-10 h-[56px] min-w-64 max-w-80 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="flex-1 min-w-0">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    navigate(
                                                                        `/catalog/products/${product.id}`,
                                                                        {
                                                                            state: {
                                                                                returnTo: `${location.pathname}${location.search}`,
                                                                            },
                                                                        },
                                                                    )
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
                                                                        平台归属异常
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] text-slate-400">
                                                                        {product.channels.length > 1
                                                                            ? `多店共享异常（${product.channels.length} 个店铺）`
                                                                            : '唯一店铺归属正常'}
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
                                                    return (
                                                        <td
                                                            key={channel.id}
                                                            className="h-[56px] whitespace-nowrap px-3 py-0 text-center border-l border-slate-100"
                                                        >
                                                            <span
                                                                className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-bold ${
                                                                    isAssigned
                                                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                                                        : 'border-slate-200 bg-white text-slate-400'
                                                                }`}
                                                            >
                                                                {isAssigned ? '归属' : '无归属'}
                                                            </span>
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
                    {filteredTotal > 0 && (
                        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                            <span>
                                共 {filteredTotal} 个匹配商品，当前第 {page + 1} / {totalPages} 页
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    aria-label="上一页"
                                    disabled={page === 0 || loading}
                                    onClick={() => changePage(Math.max(0, page - 1))}
                                    className="rounded border border-slate-300 bg-white p-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    aria-label="下一页"
                                    disabled={page + 1 >= totalPages || loading}
                                    onClick={() => changePage(Math.min(totalPages - 1, page + 1))}
                                    className="rounded border border-slate-300 bg-white p-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
