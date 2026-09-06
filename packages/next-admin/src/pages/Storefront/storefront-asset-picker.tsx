import { useQuery } from '@apollo/client/react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Search, UploadCloud, X } from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import { uploadAdminFiles } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { CREATE_ASSETS_MULTIPART } from '../../graphql/catalog-admin.graphql';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import { type StorefrontAssetRef } from '../../graphql/storefront.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    AssetQueryResult,
    CreateAssetsData,
    inputClass,
    MAX_IMAGE_SIZE_BYTES,
    supportedImageTypes,
} from './storefront-editor-model';

export function AssetPicker({
    label,
    value,
    fallbackUrl,
    onChange,
    compact = false,
}: {
    label: string;
    value: StorefrontAssetRef | null;
    fallbackUrl: string | null;
    onChange: (asset: StorefrontAssetRef | null) => void;
    compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [pageSize, setPageSize] = usePageSize(setPage);
    const deferredSearch = useDeferredValue(search.trim());
    const assets = useQuery<AssetQueryResult>(GET_ASSETS, {
        variables: {
            options: {
                skip: page * pageSize,
                take: pageSize,
                sort: { updatedAt: 'DESC', id: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(deferredSearch ? { name: { contains: deferredSearch } } : {}),
                },
            },
        },
        skip: !open,
        fetchPolicy: 'cache-first',
    });
    const items = assets.data?.assets.items ?? [];
    const totalItems = assets.data?.assets.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const preview = value?.preview ?? fallbackUrl;
    const uploadImage = async (file: File) => {
        if (!supportedImageTypes.has(file.type)) {
            setUploadError('仅支持 JPG、PNG 或 WebP 图片');
            return;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            setUploadError('图片不能超过 20 MB');
            return;
        }

        setUploading(true);
        setUploadError('');
        try {
            const result = await uploadAdminFiles<CreateAssetsData>(
                CREATE_ASSETS_MULTIPART,
                [file],
                ([filePlaceholder]) => ({
                    input: [{ file: filePlaceholder, tags: ['后台上传'] }],
                }),
            );
            const uploaded = result.createAssets[0];
            if (
                uploaded?.__typename !== 'Asset' ||
                !uploaded.id ||
                !uploaded.name ||
                !uploaded.preview ||
                !uploaded.source
            ) {
                throw new Error(uploaded?.message || 'Vendure 未返回有效的图片素材');
            }
            onChange({
                id: uploaded.id,
                name: uploaded.name,
                preview: uploaded.preview,
                source: uploaded.source,
            });
            setSearch('');
            setPage(0);
            void assets.refetch().catch(() => undefined);
        } catch (error) {
            setUploadError(toUserFacingError(error, '图片上传失败，请稍后重试'));
        } finally {
            setUploading(false);
        }
    };
    return (
        <div>
            <div className="mb-1 text-xs font-bold text-slate-700">{label}</div>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                {preview ? (
                    <img
                        src={preview}
                        alt={value?.name || '已选素材'}
                        className={`${compact ? 'h-12 w-12' : 'h-20 w-24'} rounded-md border border-slate-200 object-cover`}
                    />
                ) : (
                    <div
                        className={`${compact ? 'h-12 w-12' : 'h-20 w-24'} flex items-center justify-center rounded-md bg-slate-100 text-slate-400`}
                    >
                        <ImageIcon className="h-5 w-5" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-slate-800">
                        {value?.name ?? (preview ? '外部图片' : '未选择素材')}
                    </div>
                    <div className="mt-2 flex gap-2">
                        <input
                            ref={uploadInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={uploading}
                            className="sr-only"
                            aria-label={`上传${label}`}
                            onChange={event => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = '';
                                if (file) void uploadImage(file);
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => uploadInputRef.current?.click()}
                            disabled={uploading}
                            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <UploadCloud className={`h-3.5 w-3.5 ${uploading ? 'animate-pulse' : ''}`} />
                            {uploading ? '上传中…' : '上传图片'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setOpen(true)}
                            className="rounded-lg bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                        >
                            从素材库选择
                        </button>
                        {preview && (
                            <button
                                type="button"
                                onClick={() => onChange(null)}
                                className="rounded-lg px-2 py-1.5 text-[11px] text-rose-600 hover:bg-rose-50"
                            >
                                清除
                            </button>
                        )}
                    </div>
                </div>
            </div>
            {uploadError && (
                <p className="mt-1.5 text-[11px] text-rose-600" role="alert">
                    {uploadError}
                </p>
            )}
            {open && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) setOpen(false);
                    }}
                >
                    <AccessibleDialogSurface
                        accessibleName="选择图片素材"
                        onRequestClose={() => setOpen(false)}
                        className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="flex items-center gap-2 font-bold text-slate-900">
                                    选择图片素材
                                    <FeatureHelpButton
                                        topic="storefront.block-visuals"
                                        title="选择图片素材"
                                    />
                                </h3>
                                <p className="mt-1 text-xs text-slate-400">读取商品管理中的真实素材库</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="p-2 text-slate-400"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="relative mt-4">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                                value={search}
                                onChange={event => {
                                    setSearch(event.target.value);
                                    setPage(0);
                                }}
                                aria-label="搜索素材"
                                placeholder="搜索素材名称"
                                className={`${inputClass} pl-9`}
                            />
                        </div>
                        <div className="mt-4 grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
                            {assets.loading && !assets.data
                                ? Array.from({ length: 8 }, (_, index) => (
                                      <div
                                          key={index}
                                          className="aspect-square animate-pulse rounded-xl bg-slate-100"
                                      />
                                  ))
                                : items.map(asset => (
                                      <button
                                          key={asset.id}
                                          type="button"
                                          onClick={() => {
                                              onChange(asset);
                                              setOpen(false);
                                          }}
                                          className="overflow-hidden rounded-xl border border-slate-200 text-left hover:border-blue-500"
                                      >
                                          <img
                                              src={asset.preview}
                                              alt={asset.name}
                                              className="aspect-square w-full object-cover"
                                          />
                                          <div className="truncate p-2 text-[11px] font-bold text-slate-700">
                                              {asset.name}
                                          </div>
                                      </button>
                                  ))}
                            {!assets.loading && !items.length && (
                                <div className="col-span-full py-12 text-center text-xs text-slate-400">
                                    {assets.error
                                        ? toUserFacingError(assets.error, '图片素材读取失败，请稍后重试')
                                        : '没有匹配的图片素材'}
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-100 pt-3 text-[10px] text-slate-400">
                            <span>
                                共 {totalItems} 张图片 · {Math.min(page + 1, totalPages)} / {totalPages} 页
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                                <PageSizeSelect
                                    pageSize={pageSize}
                                    onPageSizeChange={setPageSize}
                                    disabled={assets.loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.max(0, current - 1))}
                                    disabled={page === 0 || assets.loading}
                                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                                    aria-label="上一页"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
                                    disabled={page >= totalPages - 1 || assets.loading}
                                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                                    aria-label="下一页"
                                >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}
