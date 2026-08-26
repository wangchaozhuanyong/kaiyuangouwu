import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { PageActionBarLeft } from '@/vdb/framework/layout-engine/page-layout.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { FetchQueryOptions, useQueries, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ExpandedState, getExpandedRowModel } from '@tanstack/react-table';
import { TableOptions } from '@tanstack/table-core';
import { ResultOf } from 'gql.tada';
import { ChevronRight, Folder, FolderOpen, Pencil, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
    calculateDragTargetPosition,
    calculateSiblingIndex,
    getItemParentId,
    isCircularReference,
} from '@/vdb/components/data-table/data-table-utils.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import {
    collectionListDocument,
    moveCollectionDocument,
    updateCollectionDocument,
} from './collections.graphql.js';
import { CollectionContentsSheet } from './components/collection-contents-sheet.js';
import {
    CollectionQuickCreateParent,
    CollectionQuickCreateSheet,
} from './components/collection-quick-create-sheet.js';

function parseExpandedParam(expanded?: string): ExpandedState {
    if (!expanded) return {};
    const ids = expanded.split(',').filter(Boolean);
    return Object.fromEntries(ids.map(id => [id, true]));
}

function serializeExpandedState(expanded: ExpandedState): string | undefined {
    if (expanded === true) return undefined;
    const ids = Object.entries(expanded)
        .filter(([_, v]) => v)
        .map(([id]) => id);
    return ids.length > 0 ? ids.join(',') : undefined;
}

export const Route = createFileRoute('/_authenticated/_collections/collections')({
    component: CollectionListPage,
    loader: () => ({ breadcrumb: () => <Trans>Collections</Trans> }),
    validateSearch: (search: Record<string, unknown>) => {
        return {
            ...search,
            expanded: (search.expanded as string) || undefined,
        };
    },
});

type Collection = ResultOf<typeof collectionListDocument>['collections']['items'][number];

const CHILDREN_PAGE_SIZE = 20;

type LoadMoreRow = {
    _isLoadMore: true;
    _parentId: string;
    _totalItems: number;
    _loadedItems: number;
    id: string;
    breadcrumbs: { id: string; name: string; slug: string }[];
};

type CollectionOrLoadMore = Collection | LoadMoreRow;

function isLoadMoreRow(row: CollectionOrLoadMore): row is LoadMoreRow {
    return '_isLoadMore' in row && row._isLoadMore === true;
}

function CollectionVisibilitySwitch({ collection }: Readonly<{ collection: Collection }>) {
    const queryClient = useQueryClient();
    const [isUpdating, setIsUpdating] = useState(false);

    const handleVisibilityChange = async (checked: boolean) => {
        setIsUpdating(true);
        try {
            await api.mutate(updateCollectionDocument, {
                input: { id: collection.id, isPrivate: !checked },
            });
            await queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
            toast.success(checked ? '分类已在前台显示' : '分类已从前台隐藏');
        } catch (error) {
            console.error('Failed to update collection visibility:', error);
            toast.error('更新前台显示状态失败');
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <Switch
                checked={!collection.isPrivate}
                disabled={isUpdating}
                onCheckedChange={handleVisibilityChange}
                aria-label={`${collection.name}前台显示`}
            />
            <span className="text-xs text-muted-foreground">{collection.isPrivate ? '隐藏' : '显示'}</span>
        </div>
    );
}

function CollectionListPage() {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const routeSearch = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const [expanded, setExpandedState] = useState<ExpandedState>(() =>
        parseExpandedParam(routeSearch.expanded),
    );
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [accumulatedChildren, setAccumulatedChildren] = useState<
        Record<string, { items: Collection[]; totalItems: number }>
    >({});
    const [nextPageToFetch, setNextPageToFetch] = useState<Record<string, number>>({});
    const [quickCreateOpen, setQuickCreateOpen] = useState(false);
    const [quickCreateParent, setQuickCreateParent] = useState<CollectionQuickCreateParent>();

    const openQuickCreate = (parent?: CollectionQuickCreateParent) => {
        setQuickCreateParent(parent);
        setQuickCreateOpen(true);
    };

    const handleQuickCreateOpenChange = (open: boolean) => {
        setQuickCreateOpen(open);
        if (!open) {
            setQuickCreateParent(undefined);
        }
    };

    const setExpanded = useCallback(
        (updater: ExpandedState | ((prev: ExpandedState) => ExpandedState)) => {
            setExpandedState(prev => {
                const next = typeof updater === 'function' ? updater(prev) : updater;
                navigate({
                    search: (old: Record<string, unknown>) => ({
                        ...old,
                        expanded: serializeExpandedState(next),
                    }),
                    replace: true,
                });
                return next;
            });
        },
        [navigate],
    );

    // NOTE: queryFn must be pure (no setState side effects) because TanStack Query
    // skips queryFn entirely when data is served from cache (staleTime: 5min). If we
    // called setAccumulatedChildren inside queryFn, a re-mounted component would get
    // cache hits but accumulatedChildren would never be populated, so children wouldn't
    // render. Instead we sync via useEffect below, which fires for both cache hits and
    // fresh fetches.
    const firstPageChildQueries = useQueries({
        queries:
            expanded === true
                ? []
                : Object.entries(expanded)
                      .filter(([collectionId]) => !accumulatedChildren[collectionId])
                      .map(([collectionId]) => {
                          return {
                              queryKey: ['childCollections', collectionId, 'page', 0],
                              queryFn: async () => {
                                  const result = await api.query(collectionListDocument, {
                                      options: {
                                          filter: {
                                              parentId: { eq: collectionId },
                                          },
                                          take: CHILDREN_PAGE_SIZE,
                                          skip: 0,
                                      },
                                  });
                                  return {
                                      collectionId,
                                      items: result.collections.items,
                                      totalItems: result.collections.totalItems,
                                  };
                              },
                              staleTime: 1000 * 60 * 5,
                          } satisfies FetchQueryOptions;
                      }),
    });

    useEffect(() => {
        const newChildren: Record<string, { items: Collection[]; totalItems: number }> = {};
        let hasNew = false;
        for (const query of firstPageChildQueries) {
            if (query.data && !accumulatedChildren[query.data.collectionId]) {
                newChildren[query.data.collectionId] = {
                    items: query.data.items as Collection[],
                    totalItems: query.data.totalItems,
                };
                hasNew = true;
            }
        }
        if (hasNew) {
            setAccumulatedChildren(prev => ({ ...prev, ...newChildren }));
        }
    }, [firstPageChildQueries]);

    const pagedChildQueries = useQueries({
        queries: Object.entries(nextPageToFetch)
            .filter(([_, page]) => page > 0)
            .map(([collectionId, page]) => {
                return {
                    queryKey: ['childCollections', collectionId, 'page', page],
                    queryFn: async () => {
                        const result = await api.query(collectionListDocument, {
                            options: {
                                filter: {
                                    parentId: { eq: collectionId },
                                },
                                take: CHILDREN_PAGE_SIZE,
                                skip: page * CHILDREN_PAGE_SIZE,
                            },
                        });
                        return {
                            collectionId,
                            items: result.collections.items,
                            totalItems: result.collections.totalItems,
                        };
                    },
                    staleTime: 1000 * 60 * 5,
                } satisfies FetchQueryOptions;
            }),
    });

    useEffect(() => {
        let hasUpdates = false;
        const childUpdates: Record<string, { items: Collection[]; totalItems: number }> = {};
        const fetchedPages: string[] = [];
        for (const query of pagedChildQueries) {
            if (!query.data) continue;
            const { collectionId, items, totalItems } = query.data as {
                collectionId: string;
                items: Collection[];
                totalItems: number;
            };
            if (accumulatedChildren[collectionId]) {
                childUpdates[collectionId] = {
                    items: [...accumulatedChildren[collectionId].items, ...items],
                    totalItems,
                };
                fetchedPages.push(collectionId);
                hasUpdates = true;
            }
        }
        if (hasUpdates) {
            setAccumulatedChildren(prev => ({ ...prev, ...childUpdates }));
            setNextPageToFetch(prev => {
                const next = { ...prev };
                for (const id of fetchedPages) {
                    delete next[id];
                }
                return next;
            });
        }
    }, [pagedChildQueries]);

    const addSubCollections = (data: Collection[]): CollectionOrLoadMore[] => {
        const allRows: CollectionOrLoadMore[] = [];
        const addSubRows = (row: Collection) => {
            const isExpanded = expanded === true || (typeof expanded === 'object' && expanded[row.id]);
            if (!isExpanded) {
                return;
            }
            const childData = accumulatedChildren[row.id];
            if (childData?.items.length) {
                for (const subRow of childData.items) {
                    allRows.push(subRow);
                }
                if (childData.totalItems > childData.items.length) {
                    allRows.push({
                        _isLoadMore: true,
                        _parentId: row.id,
                        _totalItems: childData.totalItems,
                        _loadedItems: childData.items.length,
                        id: `load-more-${row.id}`,
                        breadcrumbs: [
                            ...(row.breadcrumbs || []),
                            { id: row.id, name: row.name, slug: row.slug },
                        ],
                    });
                }
            }
        };
        data.forEach(row => {
            allRows.push(row);
            addSubRows(row);
        });
        return allRows;
    };

    const handleLoadMoreChildren = (parentId: string) => {
        const currentItems = accumulatedChildren[parentId]?.items.length ?? 0;
        const nextPage = Math.floor(currentItems / CHILDREN_PAGE_SIZE);
        setNextPageToFetch(prev => ({
            ...prev,
            [parentId]: nextPage,
        }));
    };

    const handleReorder = async (
        oldIndex: number,
        newIndex: number,
        item: Collection,
        allItems?: Collection[],
    ) => {
        if (isLoadMoreRow(item as CollectionOrLoadMore)) {
            return;
        }
        try {
            const rawItems = (allItems || []) as CollectionOrLoadMore[];

            // Filter out LoadMoreRows - they shouldn't affect position calculations
            const items = rawItems.filter((i): i is Collection => !isLoadMoreRow(i));

            // Recalculate indices in the filtered array
            const adjustedOldIndex = items.findIndex(i => i.id === item.id);
            const targetItem = rawItems[newIndex];
            const adjustedNewIndex = isLoadMoreRow(targetItem)
                ? items.findIndex(i => i.id === targetItem._parentId)
                : items.findIndex(i => i.id === (targetItem as Collection).id);

            const sourceParentId = getItemParentId(item);

            if (!sourceParentId) {
                throw new Error('Unable to determine parent collection ID');
            }

            const { targetParentId, adjustedIndex: initialIndex } = calculateDragTargetPosition({
                item,
                oldIndex: adjustedOldIndex,
                newIndex: adjustedNewIndex,
                items,
                sourceParentId,
                expanded,
            });

            const targetParent = items.find(candidate => candidate.id === targetParentId);
            const isMovingBelowTopLevel = Boolean(targetParent);
            if (
                (targetParent && targetParent.breadcrumbs.length !== 2) ||
                (isMovingBelowTopLevel && Boolean(item.children?.length))
            ) {
                toast.error('分类最多支持两级，不能移动到二级分类下');
                throw new Error('Collection depth limit exceeded');
            }

            if (targetParentId !== sourceParentId && isCircularReference(item, targetParentId, items)) {
                toast.error(t`Cannot move a collection into its own descendant`);
                throw new Error('Circular reference detected');
            }

            const adjustedIndex =
                targetParentId === sourceParentId
                    ? calculateSiblingIndex({
                          item,
                          oldIndex: adjustedOldIndex,
                          newIndex: adjustedNewIndex,
                          items,
                          parentId: sourceParentId,
                      })
                    : initialIndex;

            await api.mutate(moveCollectionDocument, {
                input: {
                    collectionId: item.id,
                    parentId: targetParentId,
                    index: adjustedIndex,
                },
            });

            // Remove query cache entries BEFORE clearing accumulated children
            // to prevent stale cached data from being synced back by the useEffect.
            queryClient.removeQueries({ queryKey: ['childCollections', sourceParentId] });
            if (targetParentId !== sourceParentId) {
                queryClient.removeQueries({ queryKey: ['childCollections', targetParentId] });
            }

            setAccumulatedChildren(prev => {
                const newState = { ...prev };
                delete newState[sourceParentId];
                if (targetParentId !== sourceParentId) {
                    delete newState[targetParentId];
                }
                return newState;
            });

            await queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });

            if (targetParentId === sourceParentId) {
                toast.success(t`Collection position updated`);
            } else {
                toast.success(t`Collection moved to new parent`);
            }
        } catch (error) {
            console.error('Failed to reorder collection:', error);
            if (error instanceof Error && error.message !== 'Circular reference detected') {
                toast.error(t`Failed to update collection position`);
            }
            throw error;
        }
    };

    return (
        <>
            <ListPage
                pageId="collection-category-list-v2"
                title={<Trans>Collections</Trans>}
                listQuery={collectionListDocument}
                transformVariables={input => {
                    const filterTerm = input.options?.filter?.name?.contains;
                    const isFiltering = !!filterTerm;
                    return {
                        options: {
                            ...input.options,
                            topLevelOnly: !isFiltering,
                        },
                    };
                }}
                customizeColumns={{
                    name: {
                        meta: {
                            // This column needs the following fields to always be available
                            // in order to correctly render.
                            dependencies: ['children', 'breadcrumbs'],
                        },
                        header: () => <>分类名称</>,
                        cell: ({ row }) => {
                            const original = row.original as Collection;
                            const isExpanded = row.getIsExpanded();
                            const hasChildren = !!original.children?.length;
                            const isTopLevel = original.breadcrumbs?.length === 2;
                            return (
                                <div
                                    style={{ marginLeft: (original.breadcrumbs?.length - 2) * 20 + 'px' }}
                                    className="flex gap-2 items-center"
                                >
                                    {isTopLevel ? (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            aria-label={isExpanded ? t`Collapse` : t`Expand`}
                                            onClick={row.getToggleExpandedHandler()}
                                            disabled={!hasChildren}
                                            className={!hasChildren ? 'opacity-30' : ''}
                                        >
                                            {isExpanded ? <FolderOpen /> : <Folder />}
                                        </Button>
                                    ) : (
                                        <ChevronRight className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
                                    )}
                                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                        <DetailPageButton id={original.id} label={original.name} />
                                        {isTopLevel ? (
                                            <PermissionGuard requires={['CreateCollection', 'CreateCatalog']}>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                                    onClick={() =>
                                                        openQuickCreate({
                                                            id: original.id,
                                                            name: original.name,
                                                        })
                                                    }
                                                    aria-label={`在 ${original.name} 下添加二级分类`}
                                                >
                                                    <PlusIcon className="h-4 w-4" />
                                                    <span className="hidden @xl:inline">添加二级分类</span>
                                                </Button>
                                            </PermissionGuard>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        },
                    },
                    description: {
                        cell: RichTextDescriptionCell,
                    },
                    breadcrumbs: {
                        cell: ({ cell }) => {
                            const value = cell.getValue();
                            if (!Array.isArray(value)) {
                                return null;
                            }
                            return (
                                <div>
                                    {value
                                        .slice(1)
                                        .map(breadcrumb => breadcrumb.name)
                                        .join(' / ')}
                                </div>
                            );
                        },
                    },
                    productVariantCount: {
                        header: () => <>商品数量</>,
                        cell: ({ row }) => {
                            return (
                                <CollectionContentsSheet
                                    collectionId={row.original.id}
                                    collectionName={row.original.name}
                                >
                                    {row.original.productVariantCount as number}
                                </CollectionContentsSheet>
                            );
                        },
                    },
                    children: {
                        cell: ({ row }) => {
                            const children = row.original.children ?? [];
                            const count = children.length;
                            const maxDisplay = 5;
                            const leftOver = Math.max(count - maxDisplay, 0);
                            return (
                                <div className="flex flex-wrap gap-2">
                                    {children.slice(0, maxDisplay).map(child => (
                                        <Badge key={child.id} variant="outline">
                                            {child.name}
                                        </Badge>
                                    ))}
                                    {leftOver > 0 ? (
                                        <Badge variant="outline">
                                            <Trans>+ {leftOver} more</Trans>
                                        </Badge>
                                    ) : null}
                                </div>
                            );
                        },
                    },
                    isPrivate: {
                        header: () => <>前台显示</>,
                        cell: ({ row }) => <CollectionVisibilitySwitch collection={row.original} />,
                    },
                    position: {
                        header: () => <>排序</>,
                        cell: ({ row }) => <span className="tabular-nums">{row.original.position + 1}</span>,
                    },
                }}
                additionalColumns={{
                    level: {
                        meta: { dependencies: ['breadcrumbs'] },
                        header: () => <>层级</>,
                        cell: ({ row }) => (
                            <Badge variant="outline">
                                {row.original.breadcrumbs.length === 2 ? '一级分类' : '二级分类'}
                            </Badge>
                        ),
                        enableSorting: false,
                    },
                    operation: {
                        meta: { dependencies: ['id'] },
                        header: () => <>操作</>,
                        cell: ({ row }) => (
                            <Button
                                size="sm"
                                variant="ghost"
                                render={<Link to="./$id" params={{ id: row.original.id }} />}
                            >
                                <Pencil className="h-4 w-4" /> 编辑
                            </Button>
                        ),
                        enableSorting: false,
                    },
                }}
                defaultColumnOrder={[
                    'name',
                    'level',
                    'productVariantCount',
                    'isPrivate',
                    'position',
                    'operation',
                ]}
                transformData={data => {
                    return addSubCollections(data);
                }}
                setTableOptions={(options: TableOptions<any>) => {
                    options.state = {
                        ...options.state,
                        expanded: expanded,
                    };
                    options.onExpandedChange = setExpanded;
                    options.getExpandedRowModel = getExpandedRowModel();
                    options.getRowCanExpand = () => true;
                    options.getRowId = row => row.id;
                    options.enableRowSelection = row => !isLoadMoreRow(row.original);
                    options.meta = {
                        ...options.meta,
                        resetExpanded: () => setExpanded({}),
                        refreshChildCaches: () => {
                            queryClient.removeQueries({ queryKey: ['childCollections'] });
                            queryClient.removeQueries({ queryKey: ['PaginatedListDataTable'] });
                            setAccumulatedChildren({});
                        },
                        isUtilityRow: (row: { original: CollectionOrLoadMore }) =>
                            isLoadMoreRow(row.original),
                        renderUtilityRow: (row: { original: CollectionOrLoadMore }) => {
                            const original = row.original as LoadMoreRow;
                            const remaining = original._totalItems - original._loadedItems;
                            return (
                                <div
                                    style={{ paddingLeft: (original.breadcrumbs?.length - 1) * 20 + 'px' }}
                                    className="flex justify-center py-2"
                                >
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleLoadMoreChildren(original._parentId)}
                                    >
                                        <Trans>
                                            Load {Math.min(remaining, CHILDREN_PAGE_SIZE)} more ({remaining}{' '}
                                            remaining)
                                        </Trans>
                                    </Button>
                                </div>
                            );
                        },
                    };
                    return options;
                }}
                defaultVisibility={{
                    id: false,
                    createdAt: false,
                    updatedAt: false,
                    featuredAsset: false,
                    slug: false,
                    breadcrumbs: false,
                    position: true,
                    parentId: false,
                    children: false,
                    description: false,
                    isPrivate: true,
                    level: true,
                    productVariantCount: true,
                    operation: true,
                    name: true,
                }}
                searchPlaceholder="搜索分类名称…"
                onSearchTermChange={searchTerm => {
                    setSearchTerm(searchTerm);
                    return {
                        name: { contains: searchTerm },
                    };
                }}
                route={Route}
                includeSelectionColumn={false}
                disableViewOptions
                simpleToolbar
                onReorder={handleReorder}
                disableDragAndDrop={!!searchTerm}
            >
                <PageActionBarLeft>
                    <p className="text-sm text-muted-foreground">管理店铺前台展示的商品分类</p>
                </PageActionBarLeft>
                <ActionBarItem
                    itemId="create-button"
                    requiresPermission={['CreateCollection', 'CreateCatalog']}
                >
                    <Button onClick={() => openQuickCreate()}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        新增一级分类
                    </Button>
                </ActionBarItem>
            </ListPage>
            <CollectionQuickCreateSheet
                open={quickCreateOpen}
                parent={quickCreateParent}
                onOpenChange={handleQuickCreateOpenChange}
                onCreated={parentId => {
                    if (parentId) {
                        setExpanded(current => (current === true ? true : { ...current, [parentId]: true }));
                    }
                    setAccumulatedChildren({});
                }}
            />
        </>
    );
}
