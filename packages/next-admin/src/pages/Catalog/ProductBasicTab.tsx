import { Image as ImageIcon, X } from 'lucide-react';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { RefundPolicy } from '../../graphql/commerce.graphql';
import { useProductEditor } from './ProductEditorContext';
import { SOURCE_LANGUAGE_CODE } from './product-editor-types';

export function ProductBasicTab() {
    const {
        isCreateMode,
        productName,
        setProductName,
        slug,
        setSlug,
        enabled,
        setEnabled,
        description,
        setDescription,
        fulfillmentType,
        setFulfillmentType,
        refundPolicy,
        setRefundPolicy,
        manualDeliverySlaMinutes,
        setManualDeliverySlaMinutes,
        dynamicCustomFieldValues,
        setDynamicCustomFieldValues,
        productExtensionFields,
        featuredAssetId,
        setFeaturedAssetId,
        featuredAssetPreview,
        setFeaturedAssetPreview,
        selectedAssetIds,
        setSelectedAssetIds,
        setIsAssetPickerOpen,
        setAssetPickerMode,
        knownAssets,
        formErrors,
        setFormErrors,
        commerceMode,
        productData,
        fixedFulfillmentType,
        effectiveFulfillmentType,
        saving,
    } = useProductEditor();

    if (!isCreateMode && !productData?.product) return null;

    return (
        <div className="space-y-6">
            {/* 核心属性 */}
            <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-5">
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-slate-900">SPU 核心属性</h3>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-xs font-bold text-slate-600">商品状态</span>
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={e => setEnabled(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded ${enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                        >
                            {enabled ? '启用' : '禁用'}
                        </span>
                    </label>
                </div>

                <div className="space-y-4 text-xs">
                    <div>
                        <label htmlFor="product-name" className="block font-bold text-slate-700 mb-1">
                            名称 <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            id="product-name"
                            value={productName}
                            onChange={e => {
                                setProductName(e.target.value);
                                if (formErrors.name) setFormErrors(prev => ({ ...prev, name: undefined }));
                            }}
                            placeholder="输入名称，如：无线主动降噪头戴耳机 Pro Max"
                            aria-invalid={Boolean(formErrors.name)}
                            aria-describedby={formErrors.name ? 'product-name-error' : undefined}
                            className={`w-full text-xs font-bold border rounded-lg p-2.5 bg-white focus:outline-none focus:ring-1 ${formErrors.name ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:ring-blue-500'}`}
                        />
                        {formErrors.name && (
                            <p id="product-name-error" className="text-rose-500 text-[11px] mt-1">
                                {formErrors.name}
                            </p>
                        )}
                    </div>

                    <div>
                        <label htmlFor="product-slug" className="block font-bold text-slate-700 mb-1">
                            URL 唯一别名 (Slug)
                        </label>
                        <input
                            type="text"
                            id="product-slug"
                            value={slug}
                            onChange={e => setSlug(e.target.value)}
                            placeholder="例如：wireless-noise-cancelling-headphones (留空将根据名称自动生成)"
                            className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="product-description" className="block font-bold text-slate-700 mb-1">
                            商品描述 <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                            rows={6}
                            id="product-description"
                            value={description}
                            onChange={e => {
                                setDescription(e.target.value);
                                if (formErrors.description)
                                    setFormErrors(previous => ({
                                        ...previous,
                                        description: undefined,
                                    }));
                            }}
                            placeholder="输入商品描述、规格和包装说明..."
                            aria-invalid={Boolean(formErrors.description)}
                            aria-describedby={
                                formErrors.description ? 'product-description-error' : undefined
                            }
                            className={`w-full rounded-xl border bg-white p-3 text-xs leading-relaxed focus:outline-none focus:ring-1 ${formErrors.description ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:ring-blue-500'}`}
                        />
                        {formErrors.description && (
                            <p id="product-description-error" className="mt-1 text-[11px] text-rose-500">
                                {formErrors.description}
                            </p>
                        )}
                        <p className="mt-1 text-[10px] leading-4 text-slate-400">
                            中文是商城内容源语言；英文由翻译引擎生成，并可在“多语言翻译”中复核。
                        </p>
                    </div>
                </div>
            </div>

            {/* 商品级履约类型与售后政策 */}
            <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
                <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900">商品类型与交付政策</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                        商品类型固定在 SPU 级，同一商品下所有 SKU 使用相同类型；数字交付方式仍按 SKU 配置。
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div>
                        <div className="mb-2 text-xs font-bold text-slate-700">商品类型</div>
                        {fixedFulfillmentType ? (
                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                                当前店铺为
                                <strong>
                                    {commerceMode === 'DIGITAL_ONLY' ? '仅虚拟商品' : '仅实物商品'}
                                </strong>
                                模式，本商品固定为
                                <strong>
                                    {fixedFulfillmentType === 'digital' ? '虚拟商品' : '实物商品'}
                                </strong>
                                。
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {(
                                    [
                                        ['digital', '虚拟商品', '通过邮箱完成数字交付'],
                                        ['physical', '实物商品', '需要地址、库存与物流配送'],
                                    ] as const
                                ).map(([value, label, detail]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setFulfillmentType(value)}
                                        className={`rounded-lg border p-3 text-left transition-colors ${fulfillmentType === value ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        <span className="block text-xs font-bold">{label}</span>
                                        <span className="mt-1 block text-[10px] leading-4">{detail}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label
                            htmlFor="product-refund-policy"
                            className="mb-2 block text-xs font-bold text-slate-700"
                        >
                            售后退款政策
                        </label>
                        <select
                            id="product-refund-policy"
                            value={refundPolicy}
                            onChange={event => setRefundPolicy(event.target.value as RefundPolicy)}
                            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="MERCHANT_REVIEW">允许申请退款，由商家审核</option>
                            <option value="SEVEN_DAY_NO_REASON">7 天无理由</option>
                            <option value="NON_REFUNDABLE">不支持退款</option>
                        </select>
                        <p className="mt-2 text-[10px] leading-4 text-slate-400">
                            虚拟商品交付完成后的退款进入人工客服处理，不自动回收已发送的成品或卡密。
                        </p>
                    </div>
                </div>

                {effectiveFulfillmentType === 'digital' && (
                    <div className="max-w-sm">
                        <label
                            htmlFor="manual-delivery-sla"
                            className="mb-1 block text-xs font-bold text-slate-700"
                        >
                            人工交付预计时长（分钟）
                        </label>
                        <input
                            id="manual-delivery-sla"
                            type="number"
                            min="5"
                            max="525600"
                            step="5"
                            value={manualDeliverySlaMinutes}
                            onChange={event => setManualDeliverySlaMinutes(Number(event.target.value) || 0)}
                            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-[10px] leading-4 text-slate-400">
                            仅人工交付 SKU 使用；商品页、结账页和订单详情会展示该预计时效。
                        </p>
                    </div>
                )}
            </div>

            {/* 商品图片：桌面端左主图、右详情图，窄屏自动改为上下排列。 */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                <div className="grid lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
                    <section className="p-6">
                        <div className="flex min-h-12 items-start justify-between gap-4 border-b border-slate-100 pb-3">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900">商品主图</h3>
                                <p className="mt-0.5 text-xs leading-5 text-slate-400">
                                    用于商品列表、搜索结果和详情页首屏
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                    setAssetPickerMode('FEATURED');
                                    setIsAssetPickerOpen(true);
                                }}
                                className="shrink-0 cursor-pointer rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {featuredAssetId ? '更换主图' : '选择主图'}
                            </button>
                        </div>

                        {featuredAssetPreview ? (
                            <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-start xl:flex-row xl:items-center">
                                <div className="group relative aspect-square w-36 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 xl:w-40">
                                    <img
                                        src={featuredAssetPreview}
                                        alt="商品主图预览"
                                        className="h-full w-full object-cover"
                                    />
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => {
                                            setFeaturedAssetId(null);
                                            setFeaturedAssetPreview(null);
                                        }}
                                        className="absolute right-2 top-2 rounded-full bg-slate-950/70 p-1.5 text-white opacity-100 transition hover:bg-rose-600 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                                        title="移除主图"
                                        aria-label="移除商品主图"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                                <div className="min-w-0 text-xs text-slate-500">
                                    <div className="font-mono font-bold text-slate-800">
                                        Asset ID: {featuredAssetId}
                                    </div>
                                    <div className="mt-1 text-[11px] leading-5 text-slate-400">
                                        已绑定为唯一主图，更换时不会删除素材库中的原图。
                                    </div>
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
                                className="mt-5 flex min-h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-6 text-center transition-all hover:border-blue-400 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <ImageIcon className="h-8 w-8 text-slate-300" />
                                <div className="text-xs font-bold text-slate-600">暂未设置主图</div>
                                <div className="text-[11px] text-slate-400">点击从素材库选择一张图片</div>
                            </button>
                        )}
                    </section>

                    <section className="border-t border-slate-200 bg-slate-50/40 p-6 lg:border-l lg:border-t-0">
                        <div className="flex min-h-12 items-start justify-between gap-4 border-b border-slate-200 pb-3">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900">商品详情图</h3>
                                <p className="mt-0.5 text-xs leading-5 text-slate-400">
                                    可多选素材，用于展示商品细节、功能和使用说明
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                    setAssetPickerMode('GALLERY');
                                    setIsAssetPickerOpen(true);
                                }}
                                className="shrink-0 cursor-pointer rounded-lg bg-slate-200/70 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                管理详情图 ({selectedAssetIds.length})
                            </button>
                        </div>

                        {selectedAssetIds.length > 0 ? (
                            <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(5rem,6rem))] gap-3">
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
                                                    className="h-full w-full object-cover"
                                                />
                                            ) : (
                                                <ImageIcon className="absolute inset-0 m-auto h-5 w-5 text-slate-300" />
                                            )}
                                            <button
                                                type="button"
                                                disabled={saving}
                                                onClick={() =>
                                                    setSelectedAssetIds(ids =>
                                                        ids.filter(id => id !== assetId),
                                                    )
                                                }
                                                aria-label={`移除素材 ${asset?.name ?? assetId}`}
                                                className="absolute right-1.5 top-1.5 rounded bg-slate-950/70 p-1 text-white opacity-100 transition hover:bg-rose-600 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                    setAssetPickerMode('GALLERY');
                                    setIsAssetPickerOpen(true);
                                }}
                                className="mt-5 flex min-h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-center transition-all hover:border-blue-400 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <ImageIcon className="h-8 w-8 text-slate-300" />
                                <div className="text-xs font-bold text-slate-600">暂未添加详情图</div>
                                <div className="text-[11px] text-slate-400">点击从素材库多选图片</div>
                            </button>
                        )}
                    </section>
                </div>
            </div>
            <DynamicCustomFieldsForm
                fields={productExtensionFields}
                values={dynamicCustomFieldValues}
                onChange={setDynamicCustomFieldValues}
                disabled={saving}
                title="商品扩展属性"
                languageCodes={[
                    ...new Set([
                        SOURCE_LANGUAGE_CODE,
                        ...(productData?.product?.translations.map(translation => translation.languageCode) ??
                            []),
                    ]),
                ]}
            />
        </div>
    );
}
