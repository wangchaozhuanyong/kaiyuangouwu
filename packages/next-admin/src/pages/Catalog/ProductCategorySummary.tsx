import { useId } from 'react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';
import { buildProductCollectionGroups, filterProductCollectionGroups } from './product-collection-hierarchy';
import type { CollectionItem } from './product-editor-types';
import { useProductEditor } from './ProductEditorContext';

/** Inline choices update the existing product draft; only Save Product submits the selection. */
export function ProductCategorySummary() {
    const fieldId = useId();
    const {
        selectedCollectionIds,
        setSelectedCollectionIds,
        collectionSearch,
        setCollectionSearch,
        collectionsData,
        collectionsLoading,
        collectionsError,
        refetchCollections,
        productData,
        productId,
        isCreateMode,
        saving,
    } = useProductEditor();
    const groups = buildProductCollectionGroups(collectionsData?.collections.items ?? []);
    const filteredGroups = filterProductCollectionGroups(groups, collectionSearch);
    const availableIds = new Set(
        groups.flatMap(group => [group.parent.id, ...group.children.map(c => c.id)]),
    );
    const visibleIds = new Set(
        filteredGroups.flatMap(group => [group.parent.id, ...group.children.map(c => c.id)]),
    );
    const existingById = new Map(
        (productData?.product?.collections ?? []).map(collection => [collection.id, collection] as const),
    );
    const automaticIds = new Set(
        isCreateMode
            ? []
            : [...existingById.values()]
                  .filter(collection => !hasDirectProductAssignment(collection.filters, productId ?? ''))
                  .map(collection => collection.id),
    );
    const assignedIds = [...new Set([...selectedCollectionIds, ...automaticIds])];
    const missingIds = assignedIds.filter(id => !availableIds.has(id));
    const hiddenSelectedCount = assignedIds.filter(id => availableIds.has(id) && !visibleIds.has(id)).length;
    const automaticallyMatched = (collection: CollectionItem) => automaticIds.has(collection.id);
    const toggleCollection = (id: string) => {
        if (saving) return;
        setSelectedCollectionIds(ids =>
            ids.includes(id) ? ids.filter(selectedId => selectedId !== id) : [...ids, id],
        );
    };
    const renderChoice = (collection: CollectionItem, child: boolean) => {
        const automatic = automaticallyMatched(collection);
        const selected = automatic || selectedCollectionIds.includes(collection.id);
        return (
            <label
                key={collection.id}
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-1 text-xs text-slate-700 has-disabled:cursor-default"
            >
                <AdminInput
                    type="checkbox"
                    checked={selected}
                    disabled={saving || automatic}
                    onChange={() => toggleCollection(collection.id)}
                    aria-label={`${automatic ? '自动匹配' : selected ? '取消选择' : '选择'}${child ? '二级分类' : '一级分类'}：${collection.name}`}
                    aria-describedby={automatic ? `${fieldId}-automatic` : undefined}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                />
                <span className={`min-w-0 flex-1 break-words ${child ? '' : 'font-semibold'}`}>
                    {collection.name}
                </span>
                {automatic && <span className="shrink-0 text-[10px] text-emerald-700">自动匹配</span>}
            </label>
        );
    };

    if (!isCreateMode && !productData?.product) return null;

    return (
        <section className="product-editor-panel min-w-0 space-y-3" aria-label="商品分类摘要">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    商品分类
                    <FeatureHelpButton topic="catalog.collections" title="所属商品分类" />
                </h3>
                <span className="text-xs text-slate-500">已选 {assignedIds.length} 项</span>
            </div>
            <AdminField
                htmlFor={`${fieldId}-search`}
                label="搜索分类"
                layout="stacked"
                className="text-xs text-slate-600"
            >
                <SearchInput
                    id={`${fieldId}-search`}
                    aria-label="搜索商品分类或专辑"
                    value={collectionSearch}
                    onValueChange={setCollectionSearch}
                    placeholder="搜索分类名称"
                    disabled={saving}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
            </AdminField>
            {collectionsError && (
                <div role="alert" className="space-y-1 text-xs text-rose-700">
                    <p>
                        {collectionsData ? '商品分类更新失败：' : ''}
                        {toUserFacingError(collectionsError, '商品分类读取失败，请重试')}
                    </p>
                    <AdminButton
                        type="button"
                        disabled={collectionsLoading || saving}
                        onClick={() => void refetchCollections()}
                        className="min-h-11 px-1 font-semibold text-rose-700 underline"
                    >
                        重试分类读取
                    </AdminButton>
                </div>
            )}
            {collectionsLoading && !collectionsData ? (
                <p role="status" className="text-xs text-slate-500">
                    正在读取商品分类…
                </p>
            ) : groups.length > 0 ? (
                filteredGroups.length > 0 ? (
                    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-2">
                        {filteredGroups.map(group => (
                            <div
                                key={group.parent.id}
                                className={`min-w-0 ${group.children.length > 0 ? 'col-span-full' : ''}`}
                            >
                                {renderChoice(group.parent, false)}
                                {group.children.length > 0 && (
                                    <div className="ml-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-2 border-l border-slate-100 pl-2">
                                        {group.children.map(child => renderChoice(child, true))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p role="status" className="text-xs text-slate-500">
                        未找到匹配的商品分类。
                    </p>
                )
            ) : !collectionsError ? (
                <p className="text-xs text-slate-500">当前店铺暂无商品分类。</p>
            ) : null}
            {hiddenSelectedCount > 0 && (
                <p className="text-xs text-slate-500">
                    另有 {hiddenSelectedCount} 个已选分类未在搜索结果中显示，选择仍保留。
                </p>
            )}
            {missingIds.length > 0 && (
                <p className="break-words text-xs text-slate-500">
                    已选分类暂未返回，仍保留：
                    {missingIds
                        .map(id => {
                            const collection = existingById.get(id);
                            return `${collection?.name ?? `分类 #${id}`}${collection && automaticallyMatched(collection) ? '（自动匹配）' : ''}`;
                        })
                        .join('、')}
                    。
                </p>
            )}
            {automaticIds.size > 0 && (
                <p id={`${fieldId}-automatic`} className="text-xs text-slate-500">
                    其中 {automaticIds.size} 项自动匹配，由分类规则决定，需在分类规则中调整。
                </p>
            )}
            <p className="text-xs text-slate-500">直接勾选，保存商品后生效。</p>
        </section>
    );
}
