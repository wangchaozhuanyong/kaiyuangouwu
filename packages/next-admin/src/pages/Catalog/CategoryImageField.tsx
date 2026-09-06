import { useQuery } from '@apollo/client/react';
import { Image as ImageIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { usePageSize } from '../../hooks/use-page-size';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from './LookupPager';

export interface CategoryImageAsset {
    id: string;
    name: string;
    preview: string;
}

export function CategoryImageField({
    value,
    onChange,
    disabled = false,
}: {
    value: CategoryImageAsset | null;
    onChange: (asset: CategoryImageAsset | null) => void;
    disabled?: boolean;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canReadAssets = hasAnyPermission(['ReadCatalog', 'ReadAsset']);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setPage);
    const deferredSearch = useDeferredValue(search.trim());
    const { data, loading, error, refetch } = useQuery<{
        assets: { items: CategoryImageAsset[]; totalItems: number };
    }>(GET_ASSETS, {
        variables: {
            options: {
                skip: page * pageSize,
                take: pageSize,
                sort: { updatedAt: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(deferredSearch ? { name: { contains: deferredSearch } } : {}),
                },
            },
        },
        skip: !open || !canReadAssets,
        fetchPolicy: 'cache-and-network',
    });

    return (
        <section aria-label="分类图片" className="space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold text-slate-700">
                分类图片
                <FeatureHelpButton topic="catalog.category-image" title="分类图片" />
            </h4>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                {value ? (
                    <img
                        src={value.preview}
                        alt={value.name}
                        className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 object-contain"
                    />
                ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                        <ImageIcon className="h-6 w-6" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-slate-800">
                        {value?.name || '未设置分类图片'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setOpen(current => !current)}
                            disabled={disabled || !canReadAssets}
                            aria-expanded={open}
                            className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50"
                        >
                            {open ? '收起素材库' : value ? '更换图片' : '选择图片'}
                        </button>
                        {value && (
                            <button
                                type="button"
                                onClick={() => onChange(null)}
                                disabled={disabled}
                                className="rounded-lg px-2 py-1.5 text-xs text-rose-600 disabled:opacity-50"
                            >
                                移除图片
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">
                保存后用于商城分类展示。新图片请先在“商品管理 → 素材媒体库”上传，移除图片不会删除素材。
            </p>
            {!canReadAssets && (
                <p className="text-xs text-amber-700">需要素材读取权限才能选择图片，请联系管理员。</p>
            )}
            {open && canReadAssets && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <input
                        aria-label="搜索分类图片"
                        placeholder="搜索图片名称"
                        value={search}
                        onChange={event => {
                            setSearch(event.target.value);
                            setPage(0);
                        }}
                        disabled={disabled}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {error ? (
                        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-rose-700">
                            {toUserFacingError(error, '图片加载失败，请重试')}
                            <button
                                type="button"
                                disabled={disabled || loading}
                                onClick={() => void refetch().catch(() => undefined)}
                            >
                                重试
                            </button>
                        </div>
                    ) : loading ? (
                        <p role="status" className="py-4 text-center text-xs text-slate-500">
                            正在加载图片…
                        </p>
                    ) : !data?.assets.items.length ? (
                        <p className="py-4 text-center text-xs text-slate-500">
                            暂无匹配图片，请调整搜索或先上传素材。
                        </p>
                    ) : (
                        <div className="grid max-h-64 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
                            {data.assets.items.map(asset => (
                                <button
                                    key={asset.id}
                                    type="button"
                                    aria-label={`选择图片：${asset.name}`}
                                    aria-pressed={value?.id === asset.id}
                                    disabled={disabled}
                                    onClick={() => {
                                        onChange(asset);
                                        setOpen(false);
                                    }}
                                    className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left hover:border-blue-500 disabled:opacity-50"
                                >
                                    <img
                                        src={asset.preview}
                                        alt=""
                                        loading="lazy"
                                        className="aspect-square w-full object-contain"
                                    />
                                    <div className="truncate p-2 text-[11px] text-slate-700">
                                        {asset.name}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    <LookupPager
                        loading={loading || disabled}
                        page={page}
                        pageSize={pageSize}
                        onPageSizeChange={setPageSize}
                        totalItems={data?.assets.totalItems ?? 0}
                        onPageChange={setPage}
                    />
                </div>
            )}
        </section>
    );
}
