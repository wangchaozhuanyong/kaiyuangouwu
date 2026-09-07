import { useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    Package,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { GET_PRODUCTS_BY_OPTION_GROUP } from '../../graphql/catalog-admin.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

const PAGE_SIZE = 10;

interface LinkedProduct {
    id: string;
    name: string;
    slug: string;
    enabled: boolean;
    updatedAt: string;
}

interface LinkedProductsData {
    products: {
        items: LinkedProduct[];
        totalItems: number;
    };
}

export interface OptionGroupSummary {
    id: string;
    name: string;
    code: string;
    productCount: number;
}

export function OptionGroupProductsDialog({
    group,
    onClose,
}: {
    group: OptionGroupSummary;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const deferredSearch = useDeferredValue(search.trim());
    const { data, loading, error, refetch } = useQuery<LinkedProductsData>(GET_PRODUCTS_BY_OPTION_GROUP, {
        variables: {
            options: {
                filter: {
                    optionGroupId: { eq: group.id },
                    ...(deferredSearch ? { name: { contains: deferredSearch } } : {}),
                },
                sort: { updatedAt: 'DESC' },
                skip: page * PAGE_SIZE,
                take: PAGE_SIZE,
            },
        },
        notifyOnNetworkStatusChange: true,
    });
    const products = data?.products.items ?? [];
    const totalItems = data?.products.totalItems ?? group.productCount;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
            onClick={onClose}
        >
            <AccessibleDialogSurface
                accessibleName={`${group.name}关联商品`}
                onRequestClose={onClose}
                className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                onClick={event => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="flex items-center gap-1.5 truncate text-base font-bold text-slate-900">
                                关联商品
                                <FeatureHelpButton topic="catalog.categories" title="规格模板关联商品" />
                            </h3>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                                {loading && !data ? '读取中' : `共 ${totalItems} 个`}
                            </span>
                        </div>
                        <p
                            className="mt-1 truncate text-xs text-slate-500"
                            title={`${group.name} · ${group.code}`}
                        >
                            {group.name} · <span className="font-mono">{group.code}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">打开商品后可修改或移除该规格模板。</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="关闭关联商品"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="border-b border-slate-100 px-5 py-3 sm:px-6">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                            aria-label="搜索关联商品"
                            value={search}
                            onChange={event => {
                                setSearch(event.target.value);
                                setPage(0);
                            }}
                            placeholder="按商品名称搜索"
                            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                        />
                    </div>
                </div>

                <div className="min-h-64 flex-1 overflow-y-auto">
                    {loading && !data ? (
                        <div className="space-y-3 p-5 sm:p-6" aria-label="正在加载关联商品">
                            {[1, 2, 3].map(item => (
                                <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                            ))}
                        </div>
                    ) : error ? (
                        <div
                            role="alert"
                            className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center text-xs text-rose-700"
                        >
                            <AlertCircle className="h-8 w-8 text-rose-500" />
                            <span>{toUserFacingError(error, '关联商品读取失败，请稍后重试')}</span>
                            <button
                                type="button"
                                onClick={() => void refetch()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 font-bold text-white hover:bg-rose-700"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                重试
                            </button>
                        </div>
                    ) : products.length === 0 ? (
                        <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center">
                            <Package className="h-9 w-9 text-slate-300" />
                            <p className="text-sm font-bold text-slate-700">
                                {deferredSearch ? '没有找到匹配的关联商品' : '暂无关联商品'}
                            </p>
                            <p className="text-xs text-slate-400">
                                {deferredSearch ? '请尝试其他商品名称' : '该规格模板当前未被商品使用'}
                            </p>
                        </div>
                    ) : (
                        <div className={`divide-y divide-slate-100 ${loading ? 'opacity-60' : ''}`}>
                            {products.map(product => (
                                <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        navigate(`/catalog/products/${product.id}?tab=variants`);
                                    }}
                                    className="group flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:px-6"
                                    aria-label={`打开商品：${product.name}`}
                                >
                                    <span className="min-w-0">
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className="max-w-full truncate text-sm font-bold text-slate-900 group-hover:text-blue-700">
                                                {product.name}
                                            </span>
                                            <span
                                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${product.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                                            >
                                                {product.enabled ? '已启用' : '已停用'}
                                            </span>
                                        </span>
                                        <span className="mt-1 block truncate font-mono text-[10px] text-slate-400">
                                            {product.slug} · 更新于{' '}
                                            {new Date(product.updatedAt).toLocaleDateString('zh-CN')}
                                        </span>
                                    </span>
                                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500 sm:px-6">
                    <span>
                        {totalItems > 0
                            ? `第 ${Math.min(page + 1, totalPages)} / ${totalPages} 页`
                            : '共 0 个商品'}
                    </span>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setPage(current => Math.max(0, current - 1))}
                            disabled={loading || page === 0}
                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="上一页关联商品"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
                            disabled={loading || page >= totalPages - 1}
                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="下一页关联商品"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
