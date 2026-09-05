import { Check, CornerDownRight, FolderTree, Search, Tag } from 'lucide-react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from './LookupPager';
import { buildProductCollectionGroups, filterProductCollectionGroups } from './product-collection-hierarchy';
import { LOOKUP_PAGE_SIZE, type CollectionItem } from './product-editor-types';
import { useProductEditor } from './ProductEditorContext';

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

    const collectionGroups = buildProductCollectionGroups(collectionsData?.collections.items ?? []);
    const filteredCollectionGroups = filterProductCollectionGroups(collectionGroups, collectionSearch);
    const secondLevelCollectionCount = collectionGroups.reduce(
        (count, group) => count + group.children.length,
        0,
    );
    const toggleCollection = (collectionId: string) => {
        setSelectedCollectionIds(ids =>
            ids.includes(collectionId)
                ? ids.filter(selectedId => selectedId !== collectionId)
                : [...ids, collectionId],
        );
    };
    const isAutomaticallyMatched = (collection: CollectionItem) =>
        !isCreateMode &&
        Boolean(
            productData?.product?.collections.some(
                productCollection => productCollection.id === collection.id,
            ),
        ) &&
        !hasDirectProductAssignment(collection.filters, productId ?? '');

    return (
        <div className="space-y-6">
            {/* Facet 筛选标签属性 */}
            <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-4">
                <div className="border-b border-slate-100 pb-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        Facet 属性标签关联
                        <FeatureHelpButton topic="catalog.facets" title="Facet 属性标签关联" />
                    </h3>
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
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        所属商品分类 (Collections)
                        <FeatureHelpButton topic="catalog.collections" title="所属商品分类" />
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        勾选后直接加入分类；已有 Facet 自动分类规则会完整保留，不会被人工归类覆盖
                    </p>
                </div>
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                        aria-label="搜索商品分类或专辑"
                        value={collectionSearch}
                        onChange={event => setCollectionSearch(event.target.value)}
                        placeholder="搜索一级分类、二级分类或 slug"
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
                ) : collectionGroups.length > 0 ? (
                    <div className="space-y-3 pt-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span className="rounded bg-blue-50 px-2 py-1 font-bold text-blue-700">
                                一级分类 {collectionGroups.length}
                            </span>
                            <span className="rounded bg-slate-100 px-2 py-1 font-bold text-slate-600">
                                二级分类 {secondLevelCollectionCount}
                            </span>
                            <span className="ml-auto font-medium text-slate-500">
                                已选择 {selectedCollectionIds.length} 个分类
                            </span>
                        </div>

                        {filteredCollectionGroups.length > 0 ? (
                            <div className="space-y-3">
                                {filteredCollectionGroups.map(group => {
                                    const parentSelected = selectedCollectionIds.includes(group.parent.id);
                                    const selectedChildCount = group.children.filter(child =>
                                        selectedCollectionIds.includes(child.id),
                                    ).length;
                                    return (
                                        <section
                                            key={group.parent.id}
                                            aria-labelledby={`collection-group-${group.parent.id}`}
                                            className={`overflow-hidden rounded-xl border bg-white transition-colors ${parentSelected ? 'border-blue-300' : 'border-slate-200'}`}
                                        >
                                            <div className="flex flex-col gap-2.5 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                                                <CollectionAssignmentOption
                                                    collection={group.parent}
                                                    level="primary"
                                                    selected={parentSelected}
                                                    automaticallyMatched={isAutomaticallyMatched(
                                                        group.parent,
                                                    )}
                                                    onToggle={toggleCollection}
                                                />
                                                <span className="shrink-0 pl-9 text-[10px] font-medium text-slate-400 sm:pl-0">
                                                    {group.children.length > 0
                                                        ? `${group.children.length} 个二级分类${selectedChildCount > 0 ? ` · 已选 ${selectedChildCount}` : ''}`
                                                        : '暂无二级分类'}
                                                </span>
                                            </div>

                                            {group.children.length > 0 ? (
                                                <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                                                    {group.children.map(child => (
                                                        <CollectionAssignmentOption
                                                            key={child.id}
                                                            collection={child}
                                                            level="secondary"
                                                            selected={selectedCollectionIds.includes(
                                                                child.id,
                                                            )}
                                                            automaticallyMatched={isAutomaticallyMatched(
                                                                child,
                                                            )}
                                                            onToggle={toggleCollection}
                                                        />
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="px-4 py-3 text-[11px] text-slate-400">
                                                    可直接选择上方一级分类，或先到“分类与属性”中创建二级分类。
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-500">
                                未找到匹配的一级分类或二级分类。
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                        当前店铺暂无分类专辑。
                    </div>
                )}
            </div>
        </div>
    );
}

function CollectionAssignmentOption({
    collection,
    level,
    selected,
    automaticallyMatched,
    onToggle,
}: {
    collection: CollectionItem;
    level: 'primary' | 'secondary';
    selected: boolean;
    automaticallyMatched: boolean;
    onToggle: (collectionId: string) => void;
}) {
    const isPrimary = level === 'primary';
    const Icon = isPrimary ? FolderTree : CornerDownRight;
    return (
        <label
            className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg text-xs transition-colors ${isPrimary ? 'flex-1 px-1 py-1' : `border p-3 ${selected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'}`}`}
        >
            <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(collection.id)}
                aria-label={`${selected ? '取消选择' : '选择'}${isPrimary ? '一级分类' : '二级分类'}：${collection.name}`}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
            />
            <Icon
                className={`h-4 w-4 shrink-0 ${isPrimary ? 'text-blue-600' : 'text-slate-400'}`}
                aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span
                        id={isPrimary ? `collection-group-${collection.id}` : undefined}
                        className="truncate font-bold text-slate-800"
                    >
                        {collection.name}
                    </span>
                    <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${isPrimary ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                        {isPrimary ? '一级分类' : '二级分类'}
                    </span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
                    {collection.slug}
                </span>
            </span>
            {automaticallyMatched && (
                <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                    自动匹配
                </span>
            )}
        </label>
    );
}
