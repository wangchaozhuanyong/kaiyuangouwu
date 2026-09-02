import { Check, FolderTree, Search, Tag } from 'lucide-react';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from './LookupPager';
import { useProductEditor } from './ProductEditorContext';
import { LOOKUP_PAGE_SIZE } from './product-editor-types';

export function ProductFacetsCollectionsTab() {
    const {
        selectedFacetValueIds,
        setSelectedFacetValueIds,
        selectedCollectionIds,
        setSelectedCollectionIds,
        selectedChannelIds,
        setSelectedChannelIds,
        facetSearch,
        setFacetSearch,
        facetPage,
        setFacetPage,
        collectionSearch,
        setCollectionSearch,
        collectionPage,
        setCollectionPage,
        toggleFacetValue,
        facetsData,
        facetsLoading,
        facetsError,
        refetchFacets,
        collectionsData,
        collectionsLoading,
        collectionsError,
        refetchCollections,
        productData,
        isCreateMode,
        productId,
    } = useProductEditor();

    if (!isCreateMode && !productData?.product) return null;

    return (
        <div className="space-y-6">
            {/* Facet 筛选标签属性 */}
            <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-4">
                <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900">Facet 属性标签关联</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        勾选商品所属的 Facet 标签，将直接保存至后端并用于前台筛选检索
                    </p>
                </div>
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                        aria-label="搜索商品属性"
                        value={facetSearch}
                        onChange={event => {
                            setFacetSearch(event.target.value);
                            setFacetPage(0);
                        }}
                        placeholder="搜索属性名称"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                    />
                </div>

                {facetsLoading && !facetsData ? (
                    <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">正在读取属性标签…</div>
                ) : facetsError ? (
                    <div
                        role="alert"
                        className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700"
                    >
                        <span>{toUserFacingError(facetsError, '属性标签读取失败，请稍后重试')}</span>
                        <button
                            type="button"
                            onClick={() => void refetchFacets()}
                            className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white"
                        >
                            重试
                        </button>
                    </div>
                ) : facetsData?.facets?.items && facetsData.facets.items.length > 0 ? (
                    <div className="space-y-4">
                        {facetsData.facets.items.map(facet => (
                            <div key={facet.id} className="space-y-2">
                                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                    <Tag className="w-3.5 h-3.5 text-blue-500" />
                                    <span>{facet.name}</span>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                        ({facet.code})
                                    </span>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {facet.values.map(fv => {
                                        const isSelected = selectedFacetValueIds.includes(fv.id);
                                        return (
                                            <button
                                                key={fv.id}
                                                type="button"
                                                onClick={() => toggleFacetValue(fv.id)}
                                                className={`px-3 py-1 text-xs font-medium rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-2xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                                            >
                                                {isSelected && <Check className="w-3 h-3" />}
                                                <span>{fv.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                        系统中尚未配置任何 Facet 属性标签，可在【商品 ➡️ 分类与属性】中先创建属性。
                    </div>
                )}
                <LookupPager
                    page={facetPage}
                    pageSize={LOOKUP_PAGE_SIZE}
                    totalItems={facetsData?.facets.totalItems ?? 0}
                    onPageChange={setFacetPage}
                />
            </div>

            {/* 所属商品分类 */}
            <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-3">
                <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900">所属商品分类 (Collections)</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        勾选后直接加入分类；已有 Facet 自动分类规则会完整保留，不会被人工归类覆盖
                    </p>
                </div>
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                        aria-label="搜索商品分类或专辑"
                        value={collectionSearch}
                        onChange={event => {
                            setCollectionSearch(event.target.value);
                            setCollectionPage(0);
                        }}
                        placeholder="搜索分类或专辑名称"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                    />
                </div>

                {collectionsLoading && !collectionsData ? (
                    <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">正在读取商品分类…</div>
                ) : collectionsError ? (
                    <div
                        role="alert"
                        className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700"
                    >
                        <span>{toUserFacingError(collectionsError, '商品分类读取失败，请稍后重试')}</span>
                        <button
                            type="button"
                            onClick={() => void refetchCollections()}
                            className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white"
                        >
                            重试
                        </button>
                    </div>
                ) : collectionsData?.collections?.items && collectionsData.collections.items.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                        {collectionsData.collections.items.map(col => {
                            const isSelected = selectedCollectionIds.includes(col.id);
                            const isAutomaticallyMatched =
                                !isCreateMode &&
                                productData?.product?.collections.some(
                                    collection => collection.id === col.id,
                                ) &&
                                !hasDirectProductAssignment(col.filters, productId ?? '');
                            return (
                                <label
                                    key={col.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-xs transition-colors ${isSelected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300'}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() =>
                                            setSelectedCollectionIds(ids =>
                                                isSelected
                                                    ? ids.filter(id => id !== col.id)
                                                    : [...ids, col.id],
                                            )
                                        }
                                        className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                                    />
                                    <FolderTree
                                        className="h-4 w-4 shrink-0 text-blue-500"
                                        aria-hidden="true"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-bold text-slate-800">
                                            {col.name}
                                        </span>
                                        <span className="block truncate font-mono text-[10px] text-slate-400">
                                            {col.slug}
                                        </span>
                                    </span>
                                    {isAutomaticallyMatched && (
                                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                                            自动匹配
                                        </span>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                ) : (
                    <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                        当前店铺暂无分类专辑。
                    </div>
                )}
                <LookupPager
                    page={collectionPage}
                    pageSize={LOOKUP_PAGE_SIZE}
                    totalItems={collectionsData?.collections.totalItems ?? 0}
                    onPageChange={setCollectionPage}
                />
            </div>
        </div>
    );
}
