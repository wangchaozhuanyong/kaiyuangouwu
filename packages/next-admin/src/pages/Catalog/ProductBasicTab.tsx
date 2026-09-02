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
                        <span className="text-xs font-bold text-slate-600">上架状态</span>
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={e => setEnabled(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded ${enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                        >
                            {enabled ? '已上架' : '放入仓库'}
                        </span>
                    </label>
                </div>

                <div className="space-y-4 text-xs">
                    <div>
                        <label htmlFor="product-name" className="block font-bold text-slate-700 mb-1">
                            中文商品标题 <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            id="product-name"
                            value={productName}
                            onChange={e => {
                                setProductName(e.target.value);
                                if (formErrors.name) setFormErrors(prev => ({ ...prev, name: undefined }));
                            }}
                            placeholder="输入商品名称，如：无线主动降噪头戴耳机 Pro Max"
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
                            placeholder="例如：wireless-noise-cancelling-headphones (留空将根据商品标题自动生成)"
                            className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="product-description" className="block font-bold text-slate-700 mb-1">
                            中文商品详情 <span className="text-rose-500">*</span>
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
                            placeholder="输入商品详情规格、包装清单及说明..."
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

            {/* 真实素材主图 */}
            <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-4">
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">商品主图 (Featured Asset)</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            从后端真实素材库选择一张图片作为前台商品主图
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setAssetPickerMode('FEATURED');
                            setIsAssetPickerOpen(true);
                        }}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                        {featuredAssetId ? '更换主图' : '选择素材主图'}
                    </button>
                </div>

                {featuredAssetPreview ? (
                    <div className="flex items-center gap-4">
                        <div className="w-24 h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 relative group">
                            <img
                                src={featuredAssetPreview}
                                alt="主图预览"
                                className="w-full h-full object-cover"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    setFeaturedAssetId(null);
                                    setFeaturedAssetPreview(null);
                                }}
                                className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-rose-600 text-white rounded-full transition-colors opacity-0 group-hover:opacity-100"
                                title="移除主图"
                                aria-label="移除商品主图"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="text-xs text-slate-500">
                            <div className="font-mono text-slate-800 font-bold">
                                Asset ID: {featuredAssetId}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1">
                                已绑定为商品主图，将在前台列表与详情首屏展示
                            </div>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            setAssetPickerMode('FEATURED');
                            setIsAssetPickerOpen(true);
                        }}
                        className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-6 text-center transition-all hover:border-blue-400 hover:bg-blue-50/30"
                    >
                        <ImageIcon className="w-8 h-8 text-slate-300" />
                        <div className="text-xs font-bold text-slate-600">暂未设置主图，点击从素材库选择</div>
                    </button>
                )}

                <div className="border-t border-slate-100 pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs font-bold text-slate-800">商品详情图集</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                                可多选素材，保存为 Vendure 商品 Asset 关联
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setAssetPickerMode('GALLERY');
                                setIsAssetPickerOpen(true);
                            }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                        >
                            管理图集 ({selectedAssetIds.length})
                        </button>
                    </div>
                    {selectedAssetIds.length > 0 ? (
                        <div className="flex flex-wrap gap-3">
                            {selectedAssetIds.map(assetId => {
                                const asset = knownAssets[assetId];
                                return (
                                    <div
                                        key={assetId}
                                        className="relative w-16 h-16 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 group"
                                    >
                                        {asset?.preview ? (
                                            <img
                                                src={asset.preview}
                                                alt={asset.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <ImageIcon className="w-5 h-5 text-slate-300 absolute inset-0 m-auto" />
                                        )}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSelectedAssetIds(ids => ids.filter(id => id !== assetId))
                                            }
                                            aria-label={`移除素材 ${asset?.name ?? assetId}`}
                                            className="absolute top-1 right-1 p-0.5 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-[11px] text-slate-400">暂未关联详情图。</div>
                    )}
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
