import { Image as ImageIcon, X } from 'lucide-react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { RefundPolicy } from '../../graphql/commerce.graphql';
import { useProductEditor } from './ProductEditorContext';
import { SOURCE_LANGUAGE_CODE } from './product-editor-types';

export function ProductBasicTab() {
    const {
        isCreateMode,
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
        <div className="space-y-4">
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.82fr)]">
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                    <div className="border-b border-slate-100 pb-3">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            商品描述
                            <FeatureHelpButton topic="catalog.spu-core" title="SPU 核心属性" />
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-400">编辑商城商品页中的主要文字说明</p>
                    </div>
                    <div>
                        <label
                            htmlFor="product-description"
                            className="mb-1 block text-xs font-bold text-slate-700"
                        >
                            商品描述 <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                            rows={8}
                            id="product-description"
                            value={description}
                            onChange={event => {
                                setDescription(event.target.value);
                                if (formErrors.description) {
                                    setFormErrors(previous => ({
                                        ...previous,
                                        description: undefined,
                                    }));
                                }
                            }}
                            placeholder="输入商品描述、规格和包装说明..."
                            aria-invalid={Boolean(formErrors.description)}
                            aria-describedby={
                                formErrors.description ? 'product-description-error' : undefined
                            }
                            className={`w-full resize-y rounded-lg border bg-white p-3 text-xs leading-relaxed outline-none focus:ring-1 ${
                                formErrors.description
                                    ? 'border-rose-500 focus:ring-rose-500'
                                    : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'
                            }`}
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
                </section>

                {/* 商品级履约类型与售后政策 */}
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                    <div className="border-b border-slate-100 pb-3">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            商品类型与交付政策
                            <FeatureHelpButton topic="catalog.product-policy" title="商品类型与交付政策" />
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                            商品类型固定在 SPU 级，同一商品下所有 SKU 使用相同类型；数字交付方式仍按 SKU
                            配置。
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
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
                                onChange={event =>
                                    setManualDeliverySlaMinutes(Number(event.target.value) || 0)
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <p className="mt-1 text-[10px] leading-4 text-slate-400">
                                仅人工交付 SKU 使用；商品页、结账页和订单详情会展示该预计时效。
                            </p>
                        </div>
                    )}
                </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="flex min-h-12 items-start justify-between gap-4 border-b border-slate-200 pb-3">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">
                            商品详情图
                            <FeatureHelpButton topic="catalog.product-assets" title="商品详情图" />
                        </h3>
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
                                            setSelectedAssetIds(ids => ids.filter(id => id !== assetId))
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
            <DynamicCustomFieldsForm
                helpTopic="catalog.product-editor"
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
