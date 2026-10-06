import { Check, CornerDownRight, FolderTree, Search, Tag } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from './LookupPager';
import { buildProductCollectionGroups, filterProductCollectionGroups } from './product-collection-hierarchy';
import { type CollectionItem } from './product-editor-types';
import { useProductEditor } from './ProductEditorContext';

export function ProductFacetsCollectionsTab({
    section,
    collectionSelection,
}: {
    section?: 'category' | 'facets';
    collectionSelection?: {
        selectedIds: string[];
        onChange: Dispatch<SetStateAction<string[]>>;
    };
}) {
    const {
        selectedFacetValueIds,
        selectedCollectionIds: productCollectionIds,
        setSelectedCollectionIds: setProductCollectionIds,
        facetSearch,
        setFacetSearch,
        facetPage,
        facetPageSize,
        setFacetPageSize,
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

    const selectedCollectionIds = collectionSelection?.selectedIds ?? productCollectionIds;
    const setSelectedCollectionIds = collectionSelection?.onChange ?? setProductCollectionIds;
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
        <div className={`grid min-w-0 items-start gap-4 ${section ? '' : '2xl:grid-cols-2'}`}>
            {/* Facet 筛选标签属性 */}
            {section !== 'category' && (
                <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="flex shrink-0 items-center gap-2 text-sm font-bold text-slate-900">
                            筛选属性
                            <FeatureHelpButton topic="catalog.facets" title="筛选属性" />
                        </h3>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <AdminInput
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
                    </div>

                    {facetsLoading && !facetsData ? (
                        <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
                            正在读取属性标签…
                        </div>
                    ) : facetsError ? (
                        <div
                            role="alert"
                            className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700"
                        >
                            <span>{toUserFacingError(facetsError, '属性标签读取失败，请稍后重试')}</span>
                            <AdminButton
                                type="button"
                                onClick={() => void refetchFacets()}
                                className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white"
                            >
                                重试
                            </AdminButton>
                        </div>
                    ) : facetsData?.facets?.items && facetsData.facets.items.length > 0 ? (
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-x-6 gap-y-3">
                            {facetsData.facets.items.map(facet => (
                                <div key={facet.id} className="min-w-0 space-y-2">
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-700">
                                        <Tag className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                                        <span className="break-words">{facet.name}</span>
                                        <span className="break-all text-[10px] text-slate-400 font-mono">
                                            ({facet.code})
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {facet.values.map(fv => {
                                            const isSelected = selectedFacetValueIds.includes(fv.id);
                                            return (
                                                <AdminButton
                                                    key={fv.id}
                                                    type="button"
                                                    onClick={() => toggleFacetValue(fv.id)}
                                                    className={`flex max-w-full cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-left text-xs font-medium transition-colors ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-2xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                                                >
                                                    {isSelected && <Check className="w-3 h-3" />}
                                                    <span className="min-w-0 break-words">{fv.name}</span>
                                                </AdminButton>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                            暂无筛选属性，可在商品分类与属性中添加。
                        </div>
                    )}
                    <LookupPager
                        page={facetPage}
                        loading={facetsLoading}
                        pageSize={facetPageSize}
                        onPageSizeChange={setFacetPageSize}
                        totalItems={facetsData?.facets.totalItems ?? 0}
                        onPageChange={setFacetPage}
                    />
                </div>
            )}
            {/* 所属商品分类 */}
            {section !== 'facets' && (
                <div className={`min-w-0 space-y-3 ${section ? '' : 'border-t border-slate-100 pt-3'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="flex shrink-0 items-center gap-2 text-sm font-bold text-slate-900">
                            商品分类
                            <FeatureHelpButton topic="catalog.collections" title="所属商品分类" />
                        </h3>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <SearchInput
                                aria-label="搜索商品分类或专辑"
                                value={collectionSearch}
                                onValueChange={setCollectionSearch}
                                placeholder="搜索分类名称"
                                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>

                    {collectionsError && (
                        <div
                            role="alert"
                            className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700"
                        >
                            <span>
                                {collectionsData ? '商品分类更新失败：' : ''}
                                {toUserFacingError(collectionsError, '商品分类读取失败，请稍后重试')}
                            </span>
                            <AdminButton
                                type="button"
                                disabled={collectionsLoading}
                                onClick={() => void refetchCollections()}
                                className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white"
                            >
                                重试
                            </AdminButton>
                        </div>
                    )}
                    {collectionsLoading && !collectionsData ? (
                        <div role="status" className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
                            正在读取商品分类…
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
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] items-start gap-2">
                                    {filteredCollectionGroups.map(group => {
                                        const parentSelected = selectedCollectionIds.includes(
                                            group.parent.id,
                                        );
                                        const selectedChildCount = group.children.filter(child =>
                                            selectedCollectionIds.includes(child.id),
                                        ).length;
                                        return (
                                            <section
                                                key={group.parent.id}
                                                aria-labelledby={`collection-group-${group.parent.id}`}
                                                className={`min-w-0 overflow-hidden rounded-lg border bg-white transition-colors ${parentSelected ? 'border-blue-300' : 'border-slate-200'}`}
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-slate-50/80 px-2.5 py-2">
                                                    <CollectionAssignmentOption
                                                        collection={group.parent}
                                                        level="primary"
                                                        selected={parentSelected}
                                                        automaticallyMatched={isAutomaticallyMatched(
                                                            group.parent,
                                                        )}
                                                        onToggle={toggleCollection}
                                                    />
                                                    {group.children.length > 0 && (
                                                        <span className="pl-9 text-[10px] font-medium text-slate-400">
                                                            {`${group.children.length} 个二级分类${selectedChildCount > 0 ? ` · 已选 ${selectedChildCount}` : ''}`}
                                                        </span>
                                                    )}
                                                </div>

                                                {group.children.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 p-2">
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
                    ) : !collectionsError ? (
                        <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                            当前店铺暂无分类专辑。
                        </div>
                    ) : null}
                </div>
            )}
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
            className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg text-xs transition-colors md:min-h-10 ${isPrimary ? 'flex-1 px-1 py-1' : `flex-[1_1_8rem] border px-2 py-1.5 ${selected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'}`}`}
        >
            <AdminInput
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
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span
                        id={isPrimary ? `collection-group-${collection.id}` : undefined}
                        className="min-w-0 break-words font-bold text-slate-800"
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
