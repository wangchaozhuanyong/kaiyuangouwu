/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    AlertTriangle,
    Check,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Edit3,
    Image as ImageIcon,
    Package,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { sensitiveActionContext, switchActiveChannel } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { DELETE_PRODUCT, GET_CATALOG_CHANNELS, GET_PRODUCTS } from '../../graphql/catalog.graphql';
import { useUrlListState } from '../../hooks/use-url-list-state';
import {
    getCatalogEmptyStateDescription,
    getChannelDisplayLabel,
    isDefaultChannelCode,
} from '../../utils/channel-display';

interface ProductVariantItem {
    id: string;
    name: string;
    sku: string;
    price: number;
    currencyCode: string;
    stockLevel?: string;
    stockOnHand?: number;
    stockAllocated?: number;
    enabled: boolean;
}

interface ProductItem {
    id: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
    name: string;
    slug: string;
    description?: string;
    featuredAsset?: {
        id: string;
        preview: string;
        name?: string;
    } | null;
    variants: ProductVariantItem[];
    facetValues?: Array<{
        id: string;
        code: string;
        name: string;
    }>;
    collections?: Array<{
        id: string;
        name: string;
        slug: string;
    }>;
}

interface GetProductsData {
    products: {
        items: ProductItem[];
        totalItems: number;
    };
}

interface GetCatalogChannelsData {
    activeChannel: {
        id: string;
        code: string;
        token: string;
        defaultCurrencyCode: string;
    };
    channels: {
        items: Array<{
            id: string;
            code: string;
            token: string;
            defaultCurrencyCode: string;
        }>;
        totalItems: number;
    };
}

const formatMoney = (amount: number, currencyCode: string) => {
    try {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
        }).format(amount / 100);
    } catch {
        return `${currencyCode} ${(amount / 100).toFixed(2)}`;
    }
};

export function CatalogModule() {
    const navigate = useNavigate();
    const { page, searchParams, searchTerm, setFilter, setPage, setSearchTerm } = useUrlListState();
    const statusParameter = searchParams.get('status');
    const statusFilter: 'ALL' | 'ENABLED' | 'DISABLED' =
        statusParameter === 'enabled' ? 'ENABLED' : statusParameter === 'disabled' ? 'DISABLED' : 'ALL';
    const setStatusFilter = (status: 'ALL' | 'ENABLED' | 'DISABLED') => {
        setFilter('status', status.toLowerCase(), 'all');
    };
    const pageSize = 10;

    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(
        null,
    );
    const [productToDelete, setProductToDelete] = useState<{ id: string; name: string } | null>(null);
    const [deletePassword, setDeletePassword] = useState('');
    const [isSwitchingStore, setIsSwitchingStore] = useState(false);
    const deferredSearchTerm = useDeferredValue(searchTerm);

    useEffect(() => {
        if (!notification) return;
        const timeout = window.setTimeout(() => setNotification(null), 3500);
        return () => window.clearTimeout(timeout);
    }, [notification]);

    // 构造真实 GraphQL 服务端查询参数 (服务端筛选过滤)
    const queryVariables = useMemo(() => {
        const filter: Record<string, unknown> = {};
        if (deferredSearchTerm.trim()) {
            filter.name = { contains: deferredSearchTerm.trim() };
        }
        if (statusFilter === 'ENABLED') {
            filter.enabled = { eq: true };
        } else if (statusFilter === 'DISABLED') {
            filter.enabled = { eq: false };
        }

        return {
            options: {
                skip: page * pageSize,
                take: pageSize,
                filter: Object.keys(filter).length > 0 ? filter : undefined,
                sort: { updatedAt: 'DESC' as const },
            },
        };
    }, [deferredSearchTerm, statusFilter, page, pageSize]);

    const { data, loading, error, refetch } = useQuery<GetProductsData>(GET_PRODUCTS, {
        variables: queryVariables,
        fetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: true,
    });
    const activeChannelQuery = useQuery<GetCatalogChannelsData>(GET_CATALOG_CHANNELS, {
        variables: { options: { skip: 0, take: 100, sort: { code: 'ASC' } } },
        fetchPolicy: 'cache-first',
    });

    const [deleteProductMutation, { loading: deleting }] = useMutation<{
        deleteProduct: { result: string; message?: string };
    }>(DELETE_PRODUCT, {
        onCompleted: res => {
            if (res?.deleteProduct?.result === 'DELETED') {
                showNotice(`商品《${productToDelete?.name || ''}》已删除`);
                setProductToDelete(null);
                setDeletePassword('');
                void refetch();
            } else {
                showNotice(res?.deleteProduct?.message || '商品删除失败，请稍后重试', 'error');
            }
        },
        onError: err => {
            showNotice(err.message || '商品删除失败，请稍后重试', 'error');
        },
    });

    const showNotice = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ type, message });
    };

    const totalItems = data?.products?.totalItems ?? 0;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const productList = data?.products?.items ?? [];
    const activeChannel = activeChannelQuery.data?.activeChannel;
    const activeChannelLabel = activeChannel ? getChannelDisplayLabel(activeChannel) : '当前店铺';
    const defaultChannel = activeChannelQuery.data?.channels.items.find(channel =>
        isDefaultChannelCode(channel.code),
    );
    const canSwitchToDefault = Boolean(
        defaultChannel && activeChannel && defaultChannel.id !== activeChannel.id,
    );

    const handleDeleteConfirm = () => {
        if (!productToDelete) return;
        if (!deletePassword) {
            showNotice('请输入当前管理员密码后再删除商品', 'error');
            return;
        }
        void deleteProductMutation({
            variables: { id: productToDelete.id },
            context: sensitiveActionContext(deletePassword),
        });
    };

    const handleSwitchToDefaultStore = async () => {
        if (!defaultChannel || isSwitchingStore) return;
        setIsSwitchingStore(true);
        try {
            await switchActiveChannel(defaultChannel.token);
            setPage(0);
            showNotice('已切换到默认店铺');
        } catch (switchError) {
            showNotice(
                switchError instanceof Error ? switchError.message : '切换默认店铺失败，请稍后重试',
                'error',
            );
        } finally {
            setIsSwitchingStore(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Header */}
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">商品管理</h1>
                    <p className="text-xs text-slate-500 mt-1">管理商品上下架、规格库存和销售价格</p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={loading}
                        className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
                        <span>刷新数据</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate('/catalog/products/new')}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        发布新商品
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="mx-auto w-full max-w-7xl flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                <div className="flex flex-col gap-1 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                        当前数据范围：<strong>{activeChannelLabel}</strong>
                    </span>
                    <span className="text-[11px] text-blue-700">商品、库存和价格按店铺独立显示</span>
                </div>
                {notification && (
                    <div
                        role="status"
                        className={`flex items-center gap-2 rounded-xl border p-3.5 text-xs font-medium animate-fadeIn ${notification.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
                    >
                        {notification.type === 'success' ? (
                            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                        )}
                        {notification.message}
                    </div>
                )}

                {/* 错误态：真实 API 错误提示 (杜绝假数据回退) */}
                {error && (
                    <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-800 text-xs animate-fadeIn">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>商品数据加载失败，请稍后重试或联系系统管理员。</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold cursor-pointer transition-colors"
                        >
                            重试连接
                        </button>
                    </div>
                )}

                {/* Table Container */}
                <div className="bg-white rounded-xl shadow-2xs border border-slate-200 flex flex-col min-h-[520px] overflow-hidden">
                    {/* Toolbar */}
                    <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
                        <div className="flex gap-1.5">
                            <button
                                type="button"
                                onClick={() => {
                                    setStatusFilter('ALL');
                                }}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${statusFilter === 'ALL' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                            >
                                全部商品
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStatusFilter('ENABLED');
                                }}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${statusFilter === 'ENABLED' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                            >
                                已上架
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStatusFilter('DISABLED');
                                }}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${statusFilter === 'DISABLED' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                            >
                                未上架
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={e => {
                                        setSearchTerm(e.target.value);
                                    }}
                                    aria-label="搜索商品"
                                    placeholder="搜索商品名称"
                                    className="pl-9 pr-8 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 w-64 bg-white"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                        }}
                                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                                        aria-label="清空商品搜索"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Table Data / Loading / Empty State */}
                    <div className="overflow-x-auto flex-1 relative">
                        {/* 加载态：骨架屏 */}
                        {loading && !data && (
                            <div className="p-8 space-y-4">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div
                                        key={i}
                                        className="h-12 bg-slate-100 animate-pulse rounded-lg flex items-center px-4 gap-4"
                                    >
                                        <div className="w-10 h-10 bg-slate-200 rounded shrink-0"></div>
                                        <div className="w-48 h-4 bg-slate-200 rounded"></div>
                                        <div className="w-20 h-4 bg-slate-200 rounded"></div>
                                        <div className="w-24 h-4 bg-slate-200 rounded ml-auto"></div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 空状态：真实无数据 */}
                        {!loading && !error && productList.length === 0 && (
                            <div className="flex flex-col items-center justify-center p-16 text-center space-y-3">
                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                                    <Package className="w-6 h-6" />
                                </div>
                                <div className="text-sm font-bold text-slate-700">暂无匹配的商品</div>
                                <p className="text-xs text-slate-400 max-w-xs">
                                    {getCatalogEmptyStateDescription({
                                        channelCode: activeChannel?.code,
                                        searchTerm,
                                    })}
                                </p>
                                <div className="mt-2 flex flex-wrap justify-center gap-2">
                                    {canSwitchToDefault && (
                                        <button
                                            type="button"
                                            onClick={() => void handleSwitchToDefaultStore()}
                                            disabled={isSwitchingStore}
                                            className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {isSwitchingStore ? '正在切换…' : '查看默认店铺商品'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => navigate('/catalog/products/new')}
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                                    >
                                        发布新商品
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 真实数据列表 */}
                        {productList.length > 0 && (
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-bold whitespace-nowrap">
                                        <th className="p-4 w-14">主图</th>
                                        <th className="p-4 min-w-[240px]">商品名称 / SPU Slug</th>
                                        <th className="p-4">上架状态</th>
                                        <th className="p-4">规格 SKU 变体</th>
                                        <th className="p-4">在手总库存</th>
                                        <th className="p-4">起售价</th>
                                        <th className="p-4 text-right w-40 whitespace-nowrap">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                    {productList.map(product => {
                                        const variants = product.variants || [];
                                        const pricedVariants = variants.filter(
                                            v => typeof v.price === 'number' && !isNaN(v.price),
                                        );
                                        const minPriceVariant =
                                            pricedVariants.reduce<ProductVariantItem | null>(
                                                (lowest, current) =>
                                                    !lowest || current.price < lowest.price
                                                        ? current
                                                        : lowest,
                                                null,
                                            );
                                        const totalStock = variants.reduce(
                                            (acc, v) => acc + (v.stockOnHand || 0),
                                            0,
                                        );

                                        return (
                                            <tr
                                                key={product.id}
                                                className="hover:bg-slate-50/80 transition-colors group"
                                            >
                                                {/* Featured Asset (真实素材) */}
                                                <td className="p-4">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            navigate(`/catalog/products/${product.id}`)
                                                        }
                                                        className="w-10 h-10 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer shadow-2xs"
                                                        aria-label={`编辑商品：${product.name}`}
                                                    >
                                                        {product.featuredAsset?.preview ? (
                                                            <img
                                                                src={product.featuredAsset.preview}
                                                                alt={product.name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <ImageIcon className="w-4 h-4 text-slate-300" />
                                                        )}
                                                    </button>
                                                </td>

                                                {/* Name & Slug */}
                                                <td className="p-4">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            navigate(`/catalog/products/${product.id}`)
                                                        }
                                                        className="cursor-pointer text-left text-sm font-bold text-slate-900 hover:text-blue-600"
                                                    >
                                                        {product.name}
                                                    </button>
                                                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                                        {product.slug}
                                                    </div>
                                                </td>

                                                {/* Status */}
                                                <td className="p-4 whitespace-nowrap">
                                                    {product.enabled ? (
                                                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded flex items-center gap-1 w-max">
                                                            <CheckCircle className="w-3 h-3" /> 已上架
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-bold rounded flex items-center gap-1 w-max">
                                                            <Package className="w-3 h-3" /> 仓库中
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Variants Count */}
                                                <td className="p-4 font-mono text-slate-600">
                                                    {variants.length > 0 ? (
                                                        <span>
                                                            <strong className="text-slate-900">
                                                                {variants.length}
                                                            </strong>{' '}
                                                            个规格
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 italic">
                                                            未配置规格
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Stock */}
                                                <td className="p-4 font-mono font-bold">
                                                    {variants.length > 0 ? (
                                                        <span
                                                            className={
                                                                totalStock <= 5
                                                                    ? 'text-rose-600 font-bold'
                                                                    : 'text-slate-800'
                                                            }
                                                        >
                                                            {totalStock}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">-</span>
                                                    )}
                                                </td>

                                                {/* Price */}
                                                <td className="p-4 font-mono font-bold text-slate-900 text-sm">
                                                    {minPriceVariant
                                                        ? formatMoney(
                                                              minPriceVariant.price,
                                                              minPriceVariant.currencyCode,
                                                          )
                                                        : '-'}
                                                </td>

                                                {/* Actions */}
                                                <td className="p-4 text-right whitespace-nowrap">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                navigate(`/catalog/products/${product.id}`)
                                                            }
                                                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                                        >
                                                            <Edit3 className="w-3.5 h-3.5" /> 编辑
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setDeletePassword('');
                                                                setProductToDelete({
                                                                    id: product.id,
                                                                    name: product.name,
                                                                });
                                                            }}
                                                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                                            title="删除商品"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Pagination */}
                    {totalItems > 0 && (
                        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
                            <div>
                                共 <span className="font-bold text-slate-800 font-mono">{totalItems}</span>{' '}
                                件商品，当前第{' '}
                                <span className="font-bold text-slate-800 font-mono">{page + 1}</span> /{' '}
                                <span className="font-bold text-slate-800 font-mono">{totalPages}</span> 页
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={page === 0}
                                    onClick={() => setPage(Math.max(0, page - 1))}
                                    className="px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium flex items-center gap-1"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" /> 上一页
                                </button>
                                <button
                                    type="button"
                                    disabled={page + 1 >= totalPages}
                                    onClick={() => setPage(page + 1)}
                                    className="px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium flex items-center gap-1"
                                >
                                    下一页 <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 删除二次确认弹窗 (明确为“永久删除”而非“归档”) */}
            {productToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
                    <AccessibleDialogSurface
                        accessibleName="永久删除商品"
                        onRequestClose={() => {
                            if (!deleting) {
                                setProductToDelete(null);
                                setDeletePassword('');
                            }
                        }}
                        role="alertdialog"
                        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-scaleIn"
                    >
                        <div className="flex items-center gap-3 text-rose-600">
                            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                            <h3 className="text-base font-bold text-slate-900">确认永久删除该商品？</h3>
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed">
                            确定要从数据库中永久删除商品{' '}
                            <strong className="text-slate-900">《{productToDelete.name}》</strong>{' '}
                            吗？删除后该商品及所有下属 SKU 规格变体将从数据库中彻底移除，不可恢复。
                        </p>

                        <label className="block text-xs font-bold text-slate-700">
                            当前管理员密码 *
                            <input
                                type="password"
                                autoComplete="current-password"
                                value={deletePassword}
                                onChange={event => setDeletePassword(event.target.value)}
                                placeholder="输入密码确认本人操作"
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                            />
                        </label>

                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => {
                                    setProductToDelete(null);
                                    setDeletePassword('');
                                }}
                                disabled={deleting}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteConfirm}
                                disabled={deleting || !deletePassword}
                                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {deleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                                <span>确认删除</span>
                            </button>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}
