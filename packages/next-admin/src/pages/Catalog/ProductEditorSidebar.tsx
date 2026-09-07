import { Boxes, Image as ImageIcon, Link2, Package, Tag, X } from 'lucide-react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { ImageAssetUploadButton, type UploadedImageAsset } from '../../components/ImageAssetUploadButton';
import { useProductEditor } from './ProductEditorContext';

export function ProductEditorSidebar() {
    const {
        isCreateMode,
        productData,
        productName,
        setProductName,
        slug,
        setSlug,
        enabled,
        setEnabled,
        featuredAssetId,
        setFeaturedAssetId,
        featuredAssetPreview,
        setFeaturedAssetPreview,
        setKnownAssets,
        setIsAssetPickerOpen,
        setAssetPickerMode,
        effectiveFulfillmentType,
        variants,
        selectedFacetValueIds,
        selectedCollectionIds,
        formErrors,
        setFormErrors,
        isDirty,
        saving,
    } = useProductEditor();

    const setUploadedFeaturedAsset = ([asset]: UploadedImageAsset[]) => {
        if (!asset) return;
        setKnownAssets(current => ({ ...current, [asset.id]: asset }));
        setFeaturedAssetId(asset.id);
        setFeaturedAssetPreview(asset.preview);
    };

    if (!isCreateMode && !productData?.product) return null;

    return (
        <aside
            className="order-2 self-start lg:sticky lg:top-4 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1"
            aria-label="商品固定信息"
        >
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            <Package className="h-4 w-4 text-blue-600" />
                            商品总览
                            <FeatureHelpButton topic="catalog.product-editor" title="商品编辑器" />
                        </h2>
                        <p className="mt-1 text-[11px] leading-4 text-slate-400">切换右侧步骤时保持不变</p>
                    </div>
                    <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                            isDirty ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                        }`}
                    >
                        {isDirty ? '待保存' : '已同步'}
                    </span>
                </div>

                <div className="space-y-4 p-4">
                    <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                商品主图
                                <FeatureHelpButton topic="catalog.product-assets" title="商品主图" />
                            </span>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <ImageAssetUploadButton
                                    ariaLabel="上传商品主图"
                                    label="上传"
                                    disabled={saving}
                                    onUploaded={setUploadedFeaturedAsset}
                                />
                                {featuredAssetId && (
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => {
                                            setAssetPickerMode('FEATURED');
                                            setIsAssetPickerOpen(true);
                                        }}
                                        className="text-[11px] font-bold text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        更换主图
                                    </button>
                                )}
                            </div>
                        </div>
                        {featuredAssetPreview ? (
                            <div className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                                <img
                                    src={featuredAssetPreview}
                                    alt="商品主图预览"
                                    className="h-full w-full object-cover"
                                />
                                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-slate-950/80 to-transparent px-3 pb-2.5 pt-8 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                    <span className="truncate text-[10px]">Asset #{featuredAssetId}</span>
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => {
                                            setFeaturedAssetId(null);
                                            setFeaturedAssetPreview(null);
                                        }}
                                        className="rounded-full bg-white/15 p-1 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                                        title="移除主图"
                                        aria-label="移除商品主图"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                    setAssetPickerMode('FEATURED');
                                    setIsAssetPickerOpen(true);
                                }}
                                className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 text-center transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <ImageIcon className="h-7 w-7 text-slate-300" />
                                <span className="text-xs font-bold text-slate-600">选择商品主图</span>
                                <span className="text-[10px] text-slate-400">从真实素材库中选择</span>
                            </button>
                        )}
                    </div>

                    <div>
                        <label htmlFor="product-name" className="mb-1 block text-xs font-bold text-slate-700">
                            名称 <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            disabled={saving}
                            id="product-name"
                            value={productName}
                            onChange={event => {
                                setProductName(event.target.value);
                                if (formErrors.name) {
                                    setFormErrors(previous => ({ ...previous, name: undefined }));
                                }
                            }}
                            placeholder="输入名称"
                            aria-invalid={Boolean(formErrors.name)}
                            aria-describedby={formErrors.name ? 'product-name-error' : undefined}
                            className={`w-full rounded-lg border bg-white p-2.5 text-xs font-bold outline-none focus:ring-1 ${
                                formErrors.name
                                    ? 'border-rose-500 focus:ring-rose-500'
                                    : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'
                            }`}
                        />
                        {formErrors.name && (
                            <p id="product-name-error" className="mt-1 text-[11px] text-rose-500">
                                {formErrors.name}
                            </p>
                        )}
                    </div>

                    <div>
                        <label
                            htmlFor="product-slug"
                            className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-700"
                        >
                            <Link2 className="h-3.5 w-3.5 text-slate-400" />
                            URL 唯一别名
                        </label>
                        <input
                            type="text"
                            disabled={saving}
                            id="product-slug"
                            value={slug}
                            onChange={event => setSlug(event.target.value)}
                            placeholder="留空按标题自动生成"
                            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div>
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                商品状态
                                <FeatureHelpButton topic="catalog.spu-core" title="SPU 核心属性" />
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-400">
                                {enabled ? '当前商品已启用' : '当前商品已禁用'}
                            </div>
                        </div>
                        <label className="flex shrink-0 cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                disabled={saving}
                                checked={enabled}
                                onChange={event => setEnabled(event.target.checked)}
                                className="h-4 w-4 rounded text-blue-600"
                            />
                            <span
                                className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                                    enabled
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-slate-200 text-slate-600'
                                }`}
                            >
                                {enabled ? '启用' : '禁用'}
                            </span>
                        </label>
                    </div>
                </div>

                <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/60">
                    <div className="px-2 py-3 text-center">
                        <Boxes className="mx-auto h-3.5 w-3.5 text-blue-500" />
                        <div className="mt-1 text-xs font-bold text-slate-800">{variants.length}</div>
                        <div className="text-[9px] text-slate-400">SKU</div>
                    </div>
                    <div className="px-2 py-3 text-center">
                        <Tag className="mx-auto h-3.5 w-3.5 text-violet-500" />
                        <div className="mt-1 text-xs font-bold text-slate-800">
                            {selectedFacetValueIds.length}
                        </div>
                        <div className="text-[9px] text-slate-400">标签</div>
                    </div>
                    <div className="px-2 py-3 text-center">
                        <Package className="mx-auto h-3.5 w-3.5 text-emerald-500" />
                        <div className="mt-1 text-xs font-bold text-slate-800">
                            {selectedCollectionIds.length}
                        </div>
                        <div className="text-[9px] text-slate-400">分类</div>
                    </div>
                </div>
                <div className="border-t border-slate-100 px-4 py-2.5 text-[10px] text-slate-400">
                    当前类型：
                    <span className="font-bold text-slate-600">
                        {effectiveFulfillmentType === 'digital' ? '虚拟商品' : '实物商品'}
                    </span>
                </div>
            </div>
        </aside>
    );
}
