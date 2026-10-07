import { useMutation } from '@apollo/client/react';
import { ArrowUpRight, Image as ImageIcon, Link2, LockKeyhole, Sparkles, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { ImageAssetUploadButton, type UploadedImageAsset } from '../../components/ImageAssetUploadButton';
import { COPY_PRODUCT_DOMAIN, PRODUCT_TYPE_CHANGE_ALLOWED } from '../../graphql/product-domains.graphql';
import { useAdminCapabilities } from '../../hooks/use-admin-capabilities';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { ProductAiImageDialog } from './ProductAiImageDialog';
import { useProductEditor } from './ProductEditorContext';

/** Identity fields belong to the wide information panel; the media/status sidebar stays across tabs. */
export function ProductEditorIdentityFields() {
    const fieldId = useId();
    const { isCreateMode, productName, setProductName, slug, setSlug, formErrors, setFormErrors, saving } =
        useProductEditor();
    const { canUseCapability } = useAdminCapabilities();
    const canEditProduct = canUseCapability(
        isCreateMode ? '/catalog/products/new' : '/catalog/products',
        'write',
    );

    if (!canEditProduct) {
        return (
            <dl className="min-w-0 space-y-4 text-sm">
                <div>
                    <dt className="text-slate-500">商品名称</dt>
                    <dd className="break-words">{productName}</dd>
                </div>
                <div>
                    <dt className="text-slate-500">网址标识</dt>
                    <dd className="break-all">{slug || '未设置'}</dd>
                </div>
            </dl>
        );
    }

    return (
        <div className="product-editor-identity min-w-0 space-y-4">
            <AdminField
                layout="stacked"
                htmlFor={`${fieldId}-name`}
                label={
                    <span className="text-xs font-semibold text-slate-700">
                        商品名称 <span className="text-rose-500">*</span>
                    </span>
                }
                error={
                    formErrors.name && (
                        <span id={`${fieldId}-name-error`} role="alert">
                            {formErrors.name}
                        </span>
                    )
                }
            >
                <AdminInput
                    type="text"
                    disabled={saving || !canEditProduct}
                    id={`${fieldId}-name`}
                    value={productName}
                    onChange={event => {
                        setProductName(event.target.value);
                        if (formErrors.name) {
                            setFormErrors(previous => ({ ...previous, name: undefined }));
                        }
                    }}
                    placeholder="输入商品名称"
                    aria-invalid={Boolean(formErrors.name)}
                    aria-describedby={formErrors.name ? `${fieldId}-name-error` : undefined}
                    className={`w-full rounded-lg border bg-white p-2.5 text-sm outline-none focus:ring-1 ${
                        formErrors.name
                            ? 'border-rose-500 focus:ring-rose-500'
                            : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                />
            </AdminField>
            <AdminField
                layout="stacked"
                htmlFor={`${fieldId}-slug`}
                label={
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <Link2 className="h-3.5 w-3.5 text-slate-400" />
                        URL 唯一别名
                    </span>
                }
            >
                <AdminInput
                    type="text"
                    disabled={saving || !canEditProduct}
                    id={`${fieldId}-slug`}
                    value={slug}
                    onChange={event => setSlug(event.target.value)}
                    placeholder="留空按标题自动生成"
                    className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
            </AdminField>
        </div>
    );
}

export function ProductEditorSidebar({ children }: { children?: ReactNode }) {
    const [aiDialogOpen, setAiDialogOpen] = useState(false);
    const { hasAnyPermission } = useAdminPermissions();
    const { canUseCapability } = useAdminCapabilities();
    const canCreateAsset = hasAnyPermission(['CreateAsset', 'CreateCatalog']);
    const {
        isCreateMode,
        productData,
        productName,
        enabled,
        setEnabled,
        featuredAssetId,
        setFeaturedAssetId,
        featuredAssetPreview,
        setFeaturedAssetPreview,
        setKnownAssets,
        setIsAssetPickerOpen,
        setAssetPickerMode,
        fulfillmentType,
        setFulfillmentType,
        fixedFulfillmentType,
        navigate,
        isDirty,
        setErrorMessage,
        catalogChannelsData,
        dynamicCustomFieldValues,
        saving,
    } = useProductEditor();
    const canEditProduct = canUseCapability(
        isCreateMode ? '/catalog/products/new' : '/catalog/products',
        'write',
    );
    const canCopyProduct = canEditProduct && canUseCapability('/catalog/products/new', 'write');
    const [copy, { loading: copying }] = useMutation<{ copyProductBasicsAsType: { id: string } }>(
        COPY_PRODUCT_DOMAIN,
    );
    const typeEligibility = useQuery<{ productTypeChangeAllowed: boolean }>(PRODUCT_TYPE_CHANGE_ALLOWED, {
        variables: { productId: productData?.product?.id },
        skip: isCreateMode || !productData?.product,
        fetchPolicy: 'network-only',
    });
    const typeLocked = !isCreateMode && typeEligibility.data?.productTypeChangeAllowed !== true;
    const pricingMode =
        dynamicCustomFieldValues.pricingMode ?? productData?.product?.customFields?.pricingMode;

    const copyBasics = async () => {
        if (!canCopyProduct || saving || copying || !productData?.product) return;
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

    const setUploadedFeaturedAsset = ([asset]: UploadedImageAsset[]) => {
        if (!asset) return;
        setKnownAssets(current => ({ ...current, [asset.id]: asset }));
        setFeaturedAssetId(asset.id);
        setFeaturedAssetPreview(asset.preview);
    };
    const openFeaturedAssetPicker = () => {
        setAssetPickerMode('FEATURED');
        setIsAssetPickerOpen(true);
    };

    if (!isCreateMode && !productData?.product) return null;

    return (
        <aside className="product-editor-sidebar min-w-0 self-start space-y-4" aria-label="商品固定信息">
            <section className="product-editor-panel product-editor-media-panel space-y-4 rounded-xl bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                        商品主图
                        <FeatureHelpButton topic="catalog.product-assets" title="商品主图" />
                    </h3>
                    {featuredAssetId && (
                        <span className="text-xs text-slate-500" aria-label={`图片编号 #${featuredAssetId}`}>
                            #{featuredAssetId}
                        </span>
                    )}
                </div>
                {featuredAssetPreview ? (
                    <div className="product-editor-featured-image mx-auto aspect-square w-full overflow-hidden rounded-lg bg-slate-50">
                        <img
                            src={featuredAssetPreview}
                            alt="商品主图预览"
                            className="h-full w-full object-contain"
                        />
                    </div>
                ) : canEditProduct ? (
                    <AdminButton
                        type="button"
                        disabled={saving}
                        onClick={openFeaturedAssetPicker}
                        className="product-editor-featured-image mx-auto flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 text-center transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <ImageIcon className="h-7 w-7 text-slate-300" />
                        <span className="text-xs font-bold text-slate-600">选择商品主图</span>
                    </AdminButton>
                ) : (
                    <p className="text-xs text-slate-500">尚未设置商品主图</p>
                )}
                {canEditProduct && (
                    <div className="space-y-2">
                        <div className="product-editor-media-actions flex flex-wrap items-start gap-2">
                            <ImageAssetUploadButton
                                ariaLabel="上传商品主图"
                                label="上传"
                                disabled={saving}
                                onUploaded={setUploadedFeaturedAsset}
                                className="product-editor-media-upload min-w-0 flex-1"
                            />
                            <AdminButton
                                type="button"
                                disabled={saving}
                                onClick={openFeaturedAssetPicker}
                                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {featuredAssetId ? '更换主图' : '素材库'}
                            </AdminButton>
                            {featuredAssetId && (
                                <AdminButton
                                    type="button"
                                    disabled={saving}
                                    onClick={() => {
                                        setFeaturedAssetId(null);
                                        setFeaturedAssetPreview(null);
                                    }}
                                    className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="移除主图"
                                    aria-label="移除商品主图"
                                >
                                    <X className="h-4 w-4" />
                                </AdminButton>
                            )}
                        </div>
                        {canEditProduct && canCreateAsset && (
                            <AdminButton
                                type="button"
                                disabled={saving}
                                onClick={() => setAiDialogOpen(true)}
                                className="product-editor-ai-action flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                AI 生成主图
                            </AdminButton>
                        )}
                    </div>
                )}
            </section>

            <section className="product-editor-panel space-y-4 rounded-xl bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                        商品状态
                        <FeatureHelpButton topic="catalog.spu-core" title="商品状态" />
                    </h3>
                    {canEditProduct ? (
                        <AdminButton
                            type="button"
                            role="switch"
                            aria-label="启用商品"
                            aria-checked={enabled}
                            disabled={saving}
                            onClick={() => setEnabled(!enabled)}
                            className="product-editor-enabled-switch shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                            data-enabled={enabled}
                            title={enabled ? '当前商品已启用' : '当前商品已禁用'}
                        >
                            <span className="product-editor-switch-track" aria-hidden="true">
                                <span />
                            </span>
                        </AdminButton>
                    ) : (
                        <span className="text-xs text-slate-600">{enabled ? '已启用' : '已停用'}</span>
                    )}
                </div>
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1 text-slate-500">
                            商品类型
                            <FeatureHelpButton topic="catalog.product-editor" title="商品类型" />
                        </span>
                        {!canEditProduct || typeLocked || fixedFulfillmentType ? (
                            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                                {fulfillmentType === 'physical' ? '实物商品' : '数字商品'}
                                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
                                    <LockKeyhole className="h-2.5 w-2.5" />
                                    锁定
                                </span>
                            </span>
                        ) : (
                            <AdminSelect
                                aria-label="商品类型"
                                value={fulfillmentType}
                                disabled={saving}
                                onChange={event =>
                                    setFulfillmentType(
                                        event.target.value === 'physical' ? 'physical' : 'digital',
                                    )
                                }
                                className="min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                            >
                                <option value="digital">数字商品</option>
                                <option value="physical">实物商品</option>
                            </AdminSelect>
                        )}
                    </div>
                    {pricingMode != null && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="text-slate-500">销售方式</span>
                            <span className="font-semibold text-slate-700">
                                {pricingMode === 'QUOTE_ONLY' ? '联系客服询价' : '标价销售'}
                            </span>
                        </div>
                    )}
                </div>
                {typeLocked && (
                    <p className="text-[11px] leading-relaxed text-slate-500">
                        {typeEligibility.loading
                            ? '正在检查业务数据…'
                            : typeEligibility.error
                              ? '类型检查失败，请刷新后重试'
                              : '已有业务数据，商品类型不可直接更改。'}
                    </p>
                )}
                {!isCreateMode && canCopyProduct && (
                    <AdminButton
                        type="button"
                        disabled={saving || copying || isDirty}
                        onClick={() => void copyBasics()}
                        className="inline-flex max-w-full items-center gap-1 text-left text-xs font-semibold text-blue-700 disabled:opacity-50"
                    >
                        {copying
                            ? '复制中…'
                            : `复制基础资料创建${fulfillmentType === 'digital' ? '实物' : '数字'}商品`}
                        <ArrowUpRight className="h-3 w-3 shrink-0" />
                    </AdminButton>
                )}
            </section>

            <fieldset
                key={String(canEditProduct)}
                disabled={!canEditProduct}
                className="min-w-0 border-0 p-0"
            >
                {children}
            </fieldset>

            <div className="space-y-1 px-1 text-xs text-slate-500">
                <p className="flex items-center gap-1.5">
                    销售店铺
                    <FeatureHelpButton
                        topic="catalog.variant-channels"
                        title="店铺独立商品"
                        description="如果其他店铺也要销售同款商品，请切换到目标店铺后重新创建或导入独立副本。"
                    />
                </p>
                <p className="break-words font-semibold text-slate-600">
                    {catalogChannelsData
                        ? getChannelDisplayName(catalogChannelsData.activeChannel)
                        : '当前店铺'}
                </p>
                <p className="text-[11px]">单店独立商品</p>
            </div>

            {aiDialogOpen && canEditProduct && canCreateAsset && (
                <ProductAiImageDialog
                    open
                    productName={productName}
                    onClose={() => setAiDialogOpen(false)}
                    onUse={asset => setUploadedFeaturedAsset([asset])}
                />
            )}
        </aside>
    );
}
