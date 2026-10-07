import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton } from '../../components/AdminControls';
import { AdminOverlayPortal } from '../../components/AdminOverlayHost';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';
import { buildProductCollectionGroups } from './product-collection-hierarchy';
import { useProductEditor } from './ProductEditorContext';
import { ProductFacetsCollectionsTab } from './ProductFacetsCollectionsTab';

/** Shared sidebar summary; category edits join the product draft only after confirmation. */
export function ProductCategorySummary() {
    const {
        selectedCollectionIds,
        collectionsData,
        collectionsLoading,
        collectionsError,
        refetchCollections,
        productData,
        productId,
        isCreateMode,
        saving,
    } = useProductEditor();
    const [isOpen, setIsOpen] = useState(false);
    const groups = buildProductCollectionGroups(collectionsData?.collections.items ?? []);
    const availableCollections = groups.flatMap(group => [group.parent, ...group.children]);
    const collectionById = new Map([
        ...(productData?.product?.collections ?? []).map(collection => [collection.id, collection] as const),
        ...availableCollections.map(collection => [collection.id, collection] as const),
    ]);

    if (!isCreateMode && !productData?.product) return null;

    return (
        <section className="product-editor-panel min-w-0 space-y-3" aria-label="商品分类摘要">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    商品分类
                    <FeatureHelpButton topic="catalog.collections" title="所属商品分类" />
                </h3>
                <AdminButton
                    type="button"
                    aria-label="修改商品分类"
                    aria-haspopup="dialog"
                    onClick={() => setIsOpen(true)}
                    disabled={saving}
                    className="min-h-11 px-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                    修改
                </AdminButton>
            </div>

            {selectedCollectionIds.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {selectedCollectionIds.map(id => {
                        const collection = collectionById.get(id);
                        const automaticallyMatched =
                            collection &&
                            !isCreateMode &&
                            productData?.product?.collections.some(item => item.id === id) &&
                            !hasDirectProductAssignment(collection.filters, productId ?? '');
                        return (
                            <span
                                key={id}
                                className="inline-flex max-w-full items-start gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700"
                            >
                                <Check aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
                                <span className="min-w-0 break-words">
                                    {collection?.name ?? `分类 #${id}`}
                                    {automaticallyMatched && (
                                        <span className="ml-1 text-[10px] text-emerald-700">自动匹配</span>
                                    )}
                                </span>
                            </span>
                        );
                    })}
                </div>
            ) : (
                <p className="text-xs text-slate-500">尚未选择商品分类。</p>
            )}

            {collectionsError && (
                <div role="alert" className="space-y-1 text-xs text-rose-700">
                    <p>{toUserFacingError(collectionsError, '商品分类读取失败，请重试')}</p>
                    <AdminButton
                        type="button"
                        disabled={collectionsLoading}
                        onClick={() => void refetchCollections()}
                        className="min-h-11 px-2 font-semibold text-rose-700 underline"
                    >
                        重试分类读取
                    </AdminButton>
                </div>
            )}
            <div className="flex flex-wrap justify-between gap-2 text-[11px] text-slate-500">
                <span>已选择 {selectedCollectionIds.length} 个分类</span>
                <span>
                    {collectionsLoading && !collectionsData
                        ? '正在读取分类…'
                        : collectionsData
                          ? `${availableCollections.length} 个可选`
                          : '分类数量暂不可用'}
                </span>
            </div>
            {isOpen && <ProductCategoryDialog onClose={() => setIsOpen(false)} />}
        </section>
    );
}

function ProductCategoryDialog({ onClose }: { onClose: () => void }) {
    const { selectedCollectionIds, setSelectedCollectionIds, collectionsData, saving } = useProductEditor();
    const [draftIds, setDraftIds] = useState(() => [...selectedCollectionIds]);

    const applySelection = () => {
        const unchanged =
            draftIds.length === selectedCollectionIds.length &&
            draftIds.every(id => selectedCollectionIds.includes(id));
        if (!unchanged) setSelectedCollectionIds(draftIds);
        onClose();
    };

    return (
        <AdminOverlayPortal>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6"
                onClick={onClose}
            >
                <AccessibleDialogSurface
                    accessibleName="选择商品分类"
                    onRequestClose={onClose}
                    mobilePresentation="sheet"
                    className="flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
                    onClick={event => event.stopPropagation()}
                >
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
                        <div className="min-w-0">
                            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                                选择商品分类
                                <FeatureHelpButton topic="catalog.collections" title="选择商品分类" />
                            </h2>
                            <p className="mt-1 text-xs text-slate-500">
                                确认后加入商品草稿，保存商品后生效。
                            </p>
                        </div>
                        <AdminButton
                            type="button"
                            aria-label="关闭分类选择"
                            onClick={onClose}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                        >
                            <X aria-hidden="true" className="h-5 w-5" />
                        </AdminButton>
                    </div>
                    <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
                        <ProductFacetsCollectionsTab
                            section="category"
                            collectionSelection={{ selectedIds: draftIds, onChange: setDraftIds }}
                        />
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 sm:px-6">
                        <AdminButton
                            type="button"
                            onClick={onClose}
                            className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            取消
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={applySelection}
                            disabled={saving || !collectionsData}
                            className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            确认选择
                        </AdminButton>
                    </div>
                </AccessibleDialogSurface>
            </div>
        </AdminOverlayPortal>
    );
}
