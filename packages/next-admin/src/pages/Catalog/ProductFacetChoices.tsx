import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from './LookupPager';
import type { FacetItem } from './product-editor-types';
import { useProductEditor } from './ProductEditorContext';

/** Facet selection stays in the product draft, including values outside the current search/page. */
export function ProductFacetChoices({ compact = false }: { compact?: boolean }) {
    const id = useId();
    const {
        selectedFacetValueIds,
        toggleFacetValue,
        facetSearch,
        setFacetSearch,
        facetPage,
        facetPageSize,
        setFacetPageSize,
        setFacetPage,
        facetsData,
        facetsLoading,
        facetsError,
        refetchFacets,
        saving,
    } = useProductEditor();
    const facets = facetsData?.facets.items ?? [];
    const standardFacets = compact
        ? facets.filter(facet => !facet.code.startsWith('catalog-import-'))
        : facets;
    const technicalFacets = compact ? facets.filter(facet => facet.code.startsWith('catalog-import-')) : [];
    const visibleValueIds = new Set(facets.flatMap(facet => facet.values.map(value => value.id)));
    const hiddenSelectionCount = selectedFacetValueIds.filter(
        valueId => !visibleValueIds.has(valueId),
    ).length;
    const renderFacet = (facet: FacetItem, index: number) => (
        <FacetChoicesGroup
            key={facet.id}
            facet={facet}
            compact={compact}
            initiallyOpen={index < 3 || facet.values.some(value => selectedFacetValueIds.includes(value.id))}
            searching={Boolean(facetSearch.trim())}
            selectedIds={selectedFacetValueIds}
            disabled={saving}
            onToggle={toggleFacetValue}
        />
    );
    return (
        <div className="min-w-0 space-y-3" aria-label="商品筛选属性">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    筛选属性 <FeatureHelpButton topic="catalog.facets" title="筛选属性" />
                </h3>
                <span className="text-xs text-slate-500">已选 {selectedFacetValueIds.length} 项</span>
            </div>
            <AdminField
                htmlFor={`${id}-search`}
                label="搜索属性"
                layout="stacked"
                className="text-xs text-slate-600"
            >
                <SearchInput
                    id={`${id}-search`}
                    aria-label="搜索商品属性"
                    value={facetSearch}
                    onValueChange={value => {
                        setFacetSearch(value);
                        setFacetPage(0);
                    }}
                    placeholder="搜索属性名称"
                    disabled={saving}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
            </AdminField>
            {facetsError && (
                <div role="alert" className="space-y-1 text-xs text-rose-700">
                    <p>
                        {facetsData ? '属性标签更新失败：' : ''}
                        {toUserFacingError(facetsError, '属性标签读取失败，请稍后重试')}
                    </p>
                    <AdminButton
                        type="button"
                        disabled={facetsLoading || saving}
                        onClick={() => void refetchFacets()}
                        className="min-h-11 px-1 font-semibold text-rose-700 underline"
                    >
                        重试属性读取
                    </AdminButton>
                </div>
            )}
            {facetsLoading && !facetsData ? (
                <p role="status" className="text-xs text-slate-500">
                    正在读取属性标签…
                </p>
            ) : facets.length > 0 ? (
                <div
                    className={
                        compact
                            ? 'min-w-0 divide-y divide-slate-100'
                            : 'grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4'
                    }
                >
                    {standardFacets.map(renderFacet)}
                    {technicalFacets.length > 0 && (
                        <details open={facetSearch.trim() ? true : undefined} className="min-w-0 py-1">
                            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                                <span className="min-w-0 flex-1">导入与技术标记</span>
                                <span className="font-normal">{technicalFacets.length} 组</span>
                                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                            </summary>
                            <div className="min-w-0 space-y-2">{technicalFacets.map(renderFacet)}</div>
                        </details>
                    )}
                </div>
            ) : !facetsError ? (
                <p role="status" className="text-xs text-slate-500">
                    {facetSearch.trim()
                        ? '未找到匹配的筛选属性。'
                        : '暂无筛选属性，可在商品分类与属性中添加。'}
                </p>
            ) : null}
            {hiddenSelectionCount > 0 && (
                <p className="text-xs text-slate-500">
                    另有 {hiddenSelectionCount} 个已选属性未在本页显示，选择仍保留。
                </p>
            )}
            {facetsData && (
                <LookupPager
                    page={facetPage}
                    loading={facetsLoading || saving}
                    pageSize={facetPageSize}
                    onPageSizeChange={setFacetPageSize}
                    totalItems={facetsData.facets.totalItems}
                    onPageChange={setFacetPage}
                />
            )}
        </div>
    );
}

function FacetChoicesGroup({
    facet,
    compact,
    initiallyOpen,
    searching,
    selectedIds,
    disabled,
    onToggle,
}: {
    facet: FacetItem;
    compact: boolean;
    initiallyOpen: boolean;
    searching: boolean;
    selectedIds: string[];
    disabled: boolean;
    onToggle: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(initiallyOpen);
    const selectedCount = facet.values.filter(value => selectedIds.includes(value.id)).length;
    const choices = (
        <div className="min-w-0 space-y-2 pb-2">
            <div
                className={
                    compact
                        ? 'grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-2'
                        : 'flex flex-wrap gap-2'
                }
            >
                {facet.values.map(value => (
                    <label
                        key={value.id}
                        className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-1 text-xs text-slate-700"
                    >
                        <AdminInput
                            type="checkbox"
                            checked={selectedIds.includes(value.id)}
                            disabled={disabled}
                            aria-label={`${facet.name}：${value.name}`}
                            onChange={() => onToggle(value.id)}
                            className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                        />
                        <span className="min-w-0 break-words">{value.name}</span>
                    </label>
                ))}
            </div>
            <details className="min-w-0 text-[11px] text-slate-400">
                <summary className="min-h-11 cursor-pointer py-2">属性标识</summary>
                <code className="block break-all">{facet.code}</code>
                {facet.values.map(value => (
                    <p key={value.id} className="break-words">
                        {value.name}：<code className="break-all">{value.code}</code>
                    </p>
                ))}
            </details>
        </div>
    );
    if (!compact)
        return (
            <div className="min-w-0 space-y-2">
                <h4 className="text-xs font-semibold text-slate-700">{facet.name}</h4>
                {choices}
            </div>
        );
    return (
        <details
            open={searching || expanded}
            onToggle={event => {
                if (!searching) setExpanded(event.currentTarget.open);
            }}
            className="min-w-0 py-1"
        >
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                <span className="min-w-0 break-words">{facet.name}</span>
                <span className="shrink-0 font-normal text-slate-500">
                    {selectedCount ? `已选 ${selectedCount}` : `${facet.values.length} 项`}
                </span>
                <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 shrink-0 ${searching || expanded ? 'rotate-180' : ''}`}
                />
            </summary>
            {choices}
        </details>
    );
}
