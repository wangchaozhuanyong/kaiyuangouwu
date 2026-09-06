import { AlertCircle, Image as ImageIcon, Search, X } from 'lucide-react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from './LookupPager';
import { useProductEditor } from './ProductEditorContext';

export function ProductAssetPickerModal() {
    const {
        isAssetPickerOpen,
        setIsAssetPickerOpen,
        assetPickerMode,
        assetSearch,
        setAssetSearch,
        assetPage,
        assetPageSize,
        setAssetPageSize,
        setAssetPage,
        assetsData,
        assetsLoading,
        assetsError,
        refetchAssets,
        featuredAssetId,
        setFeaturedAssetId,
        setFeaturedAssetPreview,
        selectedAssetIds,
        setSelectedAssetIds,
        setKnownAssets,
    } = useProductEditor();

    if (!isAssetPickerOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fadeIn"
            onClick={() => setIsAssetPickerOpen(false)}
        >
            <AccessibleDialogSurface
                accessibleName={assetPickerMode === 'FEATURED' ? '选择商品主图素材' : '管理商品详情图集'}
                onRequestClose={() => setIsAssetPickerOpen(false)}
                className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scaleIn max-h-[80vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <div>
                        <h3 className="text-base font-bold text-slate-900">
                            {assetPickerMode === 'FEATURED' ? '选择商品主图素材' : '管理商品详情图集'}
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {assetPickerMode === 'FEATURED'
                                ? '选中后立即作为商品主图'
                                : '可连续选择或取消多个后端素材'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsAssetPickerOpen(false)}
                        className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
                        aria-label="关闭"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                        aria-label="搜索图片素材"
                        value={assetSearch}
                        onChange={event => {
                            setAssetSearch(event.target.value);
                            setAssetPage(0);
                        }}
                        placeholder="搜索图片素材名称"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
                    />
                </div>

                <div className="flex-1 overflow-y-auto min-h-[300px]">
                    {assetsLoading && (
                        <div className="p-12 text-center text-slate-400 text-xs">正在加载素材库...</div>
                    )}

                    {!assetsLoading && assetsError && (
                        <div
                            role="alert"
                            className="flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center text-xs text-rose-700"
                        >
                            <AlertCircle className="h-8 w-8 text-rose-500" />
                            <span>{toUserFacingError(assetsError, '素材库读取失败，请稍后重试')}</span>
                            <button
                                type="button"
                                onClick={() => void refetchAssets()}
                                className="rounded-lg bg-rose-600 px-4 py-2 font-bold text-white"
                            >
                                重试
                            </button>
                        </div>
                    )}

                    {!assetsLoading &&
                        !assetsError &&
                        (!assetsData?.assets?.items || assetsData.assets.items.length === 0) && (
                            <div className="p-12 text-center text-slate-400 text-xs space-y-2">
                                <ImageIcon className="w-8 h-8 mx-auto text-slate-300" />
                                <div>素材库中暂无图片，请在【店铺 ➡️ 素材中心】中先上传素材文件。</div>
                            </div>
                        )}

                    {!assetsError && assetsData?.assets?.items && assetsData.assets.items.length > 0 && (
                        <div className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-4 md:grid-cols-5">
                            {assetsData.assets.items.map(asset => {
                                const isSelected =
                                    assetPickerMode === 'FEATURED'
                                        ? featuredAssetId === asset.id
                                        : selectedAssetIds.includes(asset.id);
                                return (
                                    <button
                                        type="button"
                                        key={asset.id}
                                        aria-pressed={isSelected}
                                        onClick={() => {
                                            setKnownAssets(current => ({
                                                ...current,
                                                [asset.id]: asset,
                                            }));
                                            if (assetPickerMode === 'FEATURED') {
                                                setFeaturedAssetId(asset.id);
                                                setFeaturedAssetPreview(asset.preview);
                                                setIsAssetPickerOpen(false);
                                            } else {
                                                setSelectedAssetIds(ids =>
                                                    ids.includes(asset.id)
                                                        ? ids.filter(id => id !== asset.id)
                                                        : [...ids, asset.id],
                                                );
                                            }
                                        }}
                                        className={`aspect-square rounded-xl border-2 overflow-hidden cursor-pointer relative group transition-all ${isSelected ? 'border-blue-600 ring-2 ring-blue-400 shadow-md' : 'border-slate-200 hover:border-blue-300'}`}
                                    >
                                        <img
                                            src={asset.preview}
                                            alt={asset.name}
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] p-1 truncate font-mono">
                                            {asset.name}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <LookupPager
                        page={assetPage}
                        loading={assetsLoading}
                        pageSize={assetPageSize}
                        onPageSizeChange={setAssetPageSize}
                        totalItems={assetsData?.assets.totalItems ?? 0}
                        onPageChange={setAssetPage}
                    />
                    <button
                        type="button"
                        onClick={() => setIsAssetPickerOpen(false)}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                    >
                        关闭
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
