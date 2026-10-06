import { useMutation } from '@apollo/client/react';
import { Image as ImageIcon, X } from 'lucide-react';
import { useId } from 'react';
import { AdminButton, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { ImageAssetUploadButton, type UploadedImageAsset } from '../../components/ImageAssetUploadButton';
import { COPY_PRODUCT_DOMAIN, PRODUCT_TYPE_CHANGE_ALLOWED } from '../../graphql/product-domains.graphql';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';
import { useProductEditor } from './ProductEditorContext';

export function ProductBasicTab() {
    const fieldId = useId();
    const {
        isCreateMode,
        description,
        setDescription,
        fulfillmentType,
        setFulfillmentType,
        selectedAssetIds,
        setSelectedAssetIds,
        setIsAssetPickerOpen,
        setAssetPickerMode,
        knownAssets,
        setKnownAssets,
        formErrors,
        setFormErrors,
        productData,
        fixedFulfillmentType,
        navigate,
        isDirty,
        setErrorMessage,
        saving,
    } = useProductEditor();
    const [copy, { loading: copying }] = useMutation<{ copyProductBasicsAsType: { id: string } }>(
        COPY_PRODUCT_DOMAIN,
    );
    const typeEligibility = useQuery<{ productTypeChangeAllowed: boolean }>(PRODUCT_TYPE_CHANGE_ALLOWED, {
        variables: { productId: productData?.product?.id },
        skip: isCreateMode || !productData?.product,
        fetchPolicy: 'network-only',
    });
    const typeLocked = !isCreateMode && typeEligibility.data?.productTypeChangeAllowed !== true;
    const copyBasics = async () => {
        if (!productData?.product) return;
        try {
            const result = await copy({
                variables: {
                    productId: productData.product.id,
                    fulfillmentType: fulfillmentType === 'digital' ? 'physical' : 'digital',
                },
            });
            if (!result.data) throw new Error('复制未返回结果');
            navigate(`/catalog/products/${result.data.copyProductBasicsAsType.id}`);
        } catch (error) {
            setErrorMessage(toUserFacingError(error));
        }
    };

    const addUploadedGalleryAssets = (assets: UploadedImageAsset[]) => {
        setKnownAssets(current => ({
            ...current,
            ...Object.fromEntries(assets.map(asset => [asset.id, asset])),
        }));
        setSelectedAssetIds(current => [...new Set([...current, ...assets.map(asset => asset.id)])]);
    };

    if (!isCreateMode && !productData?.product) return null;

    return (
        <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <AdminField
                    className="w-full min-w-0 space-y-1.5 text-xs font-semibold text-slate-700 sm:w-80"
                    label={
                        <>
                            <span className="flex min-h-6 items-center gap-2">
                                商品类型 <FeatureHelpButton topic="catalog.product-editor" title="商品类型" />
                            </span>
                        </>
                    }
                >
                    {' '}
                    <AdminSelect
                        aria-label="商品类型"
                        value={fulfillmentType}
                        disabled={saving || typeLocked || Boolean(fixedFulfillmentType)}
                        onChange={event =>
                            setFulfillmentType(event.target.value === 'physical' ? 'physical' : 'digital')
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5"
                    >
                        <option value="digital">数字商品</option>
                        <option value="physical">实物商品</option>
                    </AdminSelect>
                    {typeLocked && (
                        <span className="block text-[11px] font-normal text-slate-500">
                            {typeEligibility.loading
                                ? '正在检查业务数据…'
                                : typeEligibility.error
                                  ? '类型检查失败，请刷新后重试'
                                  : '已有业务数据，可复制基础资料创建另一类商品'}
                        </span>
                    )}
                </AdminField>
                {!isCreateMode && (
                    <div className="flex min-h-9 items-center">
                        <AdminButton
                            type="button"
                            disabled={saving || copying || isDirty}
                            onClick={() => void copyBasics()}
                            className="py-2.5 text-xs font-semibold text-blue-700 disabled:opacity-50"
                        >
                            {copying
                                ? '复制中…'
                                : `复制基础资料创建${fulfillmentType === 'digital' ? '实物' : '数字'}商品`}
                        </AdminButton>
                    </div>
                )}
            </div>
            <AdminField
                layout="stacked"
                className="block space-y-1.5 text-xs font-semibold text-slate-700"
                label={
                    <>
                        <span className="flex min-h-6 items-center gap-2">
                            商品描述 <span className="text-rose-500">*</span>
                            <FeatureHelpButton topic="catalog.spu-core" title="商品描述" />
                        </span>
                    </>
                }
            >
                {' '}
                <AdminTextArea
                    rows={4}
                    id={`${fieldId}-description`}
                    aria-label="商品描述"
                    value={description}
                    disabled={saving}
                    onChange={event => {
                        setDescription(event.target.value);
                        setFormErrors(previous => ({ ...previous, description: undefined }));
                    }}
                    className="w-full rounded-lg border border-slate-300 p-2.5 font-normal"
                />
                {formErrors.description && (
                    <span role="alert" className="block text-rose-600">
                        {formErrors.description}
                    </span>
                )}
            </AdminField>
            <section className="border-t border-slate-100 pt-3">
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
                    <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(5rem,5rem))] gap-2">
                        {selectedAssetIds.map(assetId => {
                            const asset = knownAssets[assetId];
                            return (
                                <div
                                    key={assetId}
                                    className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white"
                                    title={asset?.name ?? `Asset ID: ${assetId}`}
                                >
                                    {asset?.preview ? (
                                        <img
                                            src={asset.preview}
                                            alt={asset.name}
                                            className="h-full w-full object-contain"
                                        />
                                    ) : (
                                        <ImageIcon className="absolute inset-0 m-auto h-5 w-5 text-slate-300" />
                                    )}
                                    <AdminButton
                                        type="button"
                                        disabled={saving}
                                        onClick={() =>
                                            setSelectedAssetIds(ids => ids.filter(id => id !== assetId))
                                        }
                                        aria-label={`移除素材 ${asset?.name ?? assetId}`}
                                        className="absolute right-1.5 top-1.5 rounded bg-slate-950/70 p-1 text-white opacity-100 transition hover:bg-rose-600 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
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
