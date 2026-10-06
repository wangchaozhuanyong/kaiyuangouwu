import { AlertCircle, ArrowLeft, CheckCircle2, Save } from 'lucide-react';
import { AdminButton } from '../../components/AdminControls';
import { toUserFacingError } from '../../utils/user-facing-error';
import { ProductAssetPickerModal } from './ProductAssetPickerModal';
import { ProductEditorProvider } from './ProductEditorContext';
import { ProductEditorTitle } from './ProductEditorTitle';
import { ProductEditorWorkspace } from './ProductEditorWorkspace';
import { useProductEditorForm } from './useProductEditorForm';

export function ProductEditor() {
    const editor = useProductEditorForm();
    const {
        isCreateMode,
        leaveToProductList,
        notification,
        errorMessage,
        channelError,
        refetchChannel,
        catalogChannelsError,
        refetchCatalogChannels,
        productError,
        refetchProduct,
        productLoading,
        productData,
        handleSave,
        saving,
        isDirty,
    } = editor;
    const legacyTypeMismatch =
        !isCreateMode &&
        !!productData?.product?.customFields?.fulfillmentType &&
        !!editor.fixedFulfillmentType &&
        productData.product.customFields.fulfillmentType !== editor.fixedFulfillmentType;

    return (
        <ProductEditorProvider value={editor}>
            <div className="product-editor-page admin-mobile-editor h-full grid min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] bg-slate-50 md:grid-cols-[minmax(0,1fr)_auto] md:grid-rows-[auto_minmax(0,1fr)]">
                {/* Top Header */}
                <header className="relative md:col-start-1 md:col-span-2 md:row-start-1 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur-md sm:px-8 md:pr-80">
                    <div className="flex min-w-0 w-full items-center gap-3">
                        <AdminButton
                            type="button"
                            onClick={leaveToProductList}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                            title="返回商品列表"
                            aria-label="返回商品列表"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </AdminButton>
                        <ProductEditorTitle
                            isCreateMode={isCreateMode}
                            productName={editor.productName}
                            enabled={productData?.product?.enabled}
                        />
                    </div>
                </header>

                {/* Main Form Body */}
                <div className="admin-mobile-editor-body w-full min-h-0 overflow-y-auto md:col-start-1 md:col-span-2 md:row-start-2">
                    <div className="product-editor-body-content w-full min-w-0 space-y-4 p-3 sm:p-4">
                        {/* 成功通知 */}
                        {notification && (
                            <div
                                role="status"
                                className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-medium animate-fadeIn"
                            >
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> {notification}
                            </div>
                        )}

                        {/* 错误提示 */}
                        {legacyTypeMismatch && (
                            <div
                                role="alert"
                                className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
                            >
                                此历史商品的存储类型与当前店铺模式不符，暂不能在本店保存。请先核对原归属渠道及商品类型，再完成数据迁移。
                            </div>
                        )}
                        {errorMessage && (
                            <div
                                role="alert"
                                className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2 animate-fadeIn"
                            >
                                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                <span>{errorMessage}</span>
                            </div>
                        )}

                        {channelError && (
                            <div
                                role="alert"
                                className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 animate-fadeIn"
                            >
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                    <span>
                                        {toUserFacingError(
                                            channelError,
                                            '无法读取当前销售渠道，商品语言与币种配置暂不可用',
                                        )}
                                    </span>
                                </div>
                                <AdminButton
                                    type="button"
                                    onClick={() => void refetchChannel()}
                                    className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-700"
                                >
                                    重试
                                </AdminButton>
                            </div>
                        )}

                        {catalogChannelsError && (
                            <div
                                role="alert"
                                className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 animate-fadeIn"
                            >
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                                    <span>
                                        {toUserFacingError(
                                            catalogChannelsError,
                                            '无法读取可用店铺，暂不能保存商品销售范围',
                                        )}
                                    </span>
                                </div>
                                <AdminButton
                                    type="button"
                                    onClick={() => void refetchCatalogChannels()}
                                    className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-700"
                                >
                                    重试
                                </AdminButton>
                            </div>
                        )}

                        {/* 查询已有商品失败 */}
                        {productError && (
                            <div
                                role="alert"
                                className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between"
                            >
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                    <span>
                                        {toUserFacingError(productError, '商品详情读取失败，请稍后重试')}
                                    </span>
                                </div>
                                <AdminButton
                                    type="button"
                                    onClick={() => refetchProduct()}
                                    className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold cursor-pointer"
                                >
                                    重试查询
                                </AdminButton>
                            </div>
                        )}

                        {/* 骨架屏 */}
                        {productLoading && !productData && (
                            <div className="space-y-4 p-8 bg-white rounded-xl border border-slate-200 animate-pulse">
                                <div className="h-6 bg-slate-200 rounded w-1/3"></div>
                                <div className="h-10 bg-slate-100 rounded"></div>
                                <div className="h-24 bg-slate-100 rounded"></div>
                            </div>
                        )}

                        {!isCreateMode &&
                            !productLoading &&
                            !productError &&
                            productData &&
                            !productData.product && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
                                    <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
                                    <h2 className="mt-3 text-sm font-bold text-amber-900">
                                        商品不存在或当前账号无权查看
                                    </h2>
                                    <p className="mt-1 text-xs text-amber-700">
                                        请返回商品列表重新选择，不会使用空白数据覆盖商品。
                                    </p>
                                    <AdminButton
                                        type="button"
                                        onClick={leaveToProductList}
                                        className="mt-4 rounded-lg bg-amber-700 px-4 py-2 text-xs font-bold text-white"
                                    >
                                        返回商品列表
                                    </AdminButton>
                                </div>
                            )}

                        <ProductEditorWorkspace />
                    </div>
                </div>

                <div className="product-editor-save-bar admin-mobile-save-bar flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 md:col-start-2 md:row-start-1 md:z-40 md:self-center md:border-0 md:pr-8">
                    <span className="product-editor-draft-label text-xs text-slate-500" aria-live="polite">
                        {isDirty ? '有未保存修改' : '未修改'}
                    </span>
                    <AdminButton
                        type="button"
                        onClick={leaveToProductList}
                        className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                        取消
                    </AdminButton>
                    <AdminButton
                        type="button"
                        onClick={handleSave}
                        disabled={saving || legacyTypeMismatch}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                        {saving ? (
                            <>
                                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>保存中...</span>
                            </>
                        ) : (
                            <>
                                <Save className="w-3.5 h-3.5" />
                                <span>保存商品</span>
                                {isDirty && (
                                    <span
                                        className="w-1.5 h-1.5 rounded-full bg-emerald-300"
                                        title="有未保存变更"
                                    />
                                )}
                            </>
                        )}
                    </AdminButton>
                </div>

                {/* Modals */}
                <ProductAssetPickerModal />
            </div>
        </ProductEditorProvider>
    );
}
