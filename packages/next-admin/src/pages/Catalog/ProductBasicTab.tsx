import { Image as ImageIcon, X } from 'lucide-react';
import { useId, useState } from 'react';
import { AdminButton, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { ImageAssetUploadButton, type UploadedImageAsset } from '../../components/ImageAssetUploadButton';
import { useProductEditor } from './ProductEditorContext';

export function ProductBasicTab() {
    const fieldId = useId();
    const {
        isCreateMode,
        description,
        setDescription,
        selectedAssetIds,
        setSelectedAssetIds,
        setIsAssetPickerOpen,
        setAssetPickerMode,
        knownAssets,
        setKnownAssets,
        formErrors,
        setFormErrors,
        productData,
        saving,
    } = useProductEditor();
    const [readingRequested, setReading] = useState(false);
    const reading = readingRequested && !formErrors.description;

    const addUploadedGalleryAssets = (assets: UploadedImageAsset[]) => {
        setKnownAssets(current => ({
            ...current,
            ...Object.fromEntries(assets.map(asset => [asset.id, asset])),
        }));
        setSelectedAssetIds(current => [...new Set([...current, ...assets.map(asset => asset.id)])]);
    };

    if (!isCreateMode && !productData?.product) return null;

    return (
        <div className="product-editor-basic min-w-0 space-y-5">
            <section className="product-editor-panel">
                <div className="product-editor-panel-heading">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        商品描述 <span className="text-rose-500">*</span>
                        <FeatureHelpButton topic="catalog.spu-core" title="商品描述" />
                    </h2>
                    <div className="flex items-center gap-1" aria-label="描述显示方式">
                        <AdminButton
                            type="button"
                            aria-pressed={!reading}
                            onClick={() => setReading(false)}
                            className="product-editor-view-button"
                        >
                            编辑
                        </AdminButton>
                        <AdminButton
                            type="button"
                            aria-pressed={reading}
                            onClick={() => setReading(true)}
                            className="product-editor-view-button"
                        >
                            阅读
                        </AdminButton>
                    </div>
                </div>
                <div hidden={reading}>
                    <AdminField
                        layout="stacked"
                        className="product-editor-description-field text-sm text-slate-700"
                        label={<span className="sr-only">商品描述</span>}
                    >
                        {' '}
                        <AdminTextArea
                            rows={14}
                            id={`${fieldId}-description`}
                            aria-label="商品描述"
                            value={description}
                            disabled={saving}
                            onChange={event => {
                                setReading(false);
                                setDescription(event.target.value);
                                setFormErrors(previous => ({ ...previous, description: undefined }));
                            }}
                            aria-invalid={Boolean(formErrors.description)}
                            aria-describedby={
                                formErrors.description ? `${fieldId}-description-error` : undefined
                            }
                            className="product-editor-description w-full rounded-lg border border-slate-300 p-3 font-normal"
                        />
                        {formErrors.description && (
                            <span
                                id={`${fieldId}-description-error`}
                                role="alert"
                                className="block text-rose-600"
                            >
                                {formErrors.description}
                            </span>
                        )}
                    </AdminField>
                </div>
                {reading && (
                    <div className="product-editor-description-reader" aria-label="商品描述阅读">
                        {description || '尚未填写商品描述'}
                    </div>
                )}
                <p className="mt-2 text-right text-xs text-slate-400">{description.length} 字符</p>
            </section>
            <section className="product-editor-panel">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            商品详情图
                            <FeatureHelpButton topic="catalog.product-assets" title="商品详情图" />
                        </h3>
                    </div>
                    <div className="flex w-full shrink-0 flex-wrap justify-start gap-2 sm:w-auto sm:justify-end">
                        <ImageAssetUploadButton
                            ariaLabel="上传商品详情图"
                            label="上传详情图"
                            multiple
                            disabled={saving}
                            onUploaded={addUploadedGalleryAssets}
                        />
                        <AdminButton
                            type="button"
                            disabled={saving}
                            onClick={() => {
                                setAssetPickerMode('GALLERY');
                                setIsAssetPickerOpen(true);
                            }}
                            className="shrink-0 cursor-pointer rounded-lg bg-slate-200/70 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            管理详情图 ({selectedAssetIds.length})
                        </AdminButton>
                    </div>
                </div>

                {selectedAssetIds.length > 0 ? (
                    <div className="product-editor-gallery mt-3 grid gap-2">
                        {selectedAssetIds.map(assetId => {
                            const asset = knownAssets[assetId];
                            return (
                                <div
                                    key={assetId}
                                    className="product-editor-gallery-item"
                                    title={asset?.name ?? `Asset ID: ${assetId}`}
                                >
                                    {asset?.preview ? (
                                        <img
                                            src={asset.preview}
                                            alt={asset.name}
                                            className="h-16 w-16 shrink-0 rounded-lg object-contain"
                                        />
                                    ) : (
                                        <ImageIcon className="h-16 w-16 shrink-0 p-4 text-slate-300" />
                                    )}
                                    <span className="min-w-0 flex-1 break-all text-xs text-slate-600">
                                        {asset?.name ?? `图片 #${assetId}`}
                                    </span>
                                    <AdminButton
                                        type="button"
                                        disabled={saving}
                                        onClick={() =>
                                            setSelectedAssetIds(ids => ids.filter(id => id !== assetId))
                                        }
                                        aria-label={`移除素材 ${asset?.name ?? assetId}`}
                                        className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                                    >
                                        <X className="h-3 w-3" />
                                    </AdminButton>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <AdminButton
                        type="button"
                        disabled={saving}
                        onClick={() => {
                            setAssetPickerMode('GALLERY');
                            setIsAssetPickerOpen(true);
                        }}
                        className="mt-3 flex min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 bg-white p-3 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <ImageIcon className="h-8 w-8 text-slate-300" />
                        <div className="text-xs font-bold text-slate-600">暂未添加详情图</div>
                        <div className="text-[11px] text-slate-400">点击从素材库多选图片</div>
                    </AdminButton>
                )}
            </section>
        </div>
    );
}
