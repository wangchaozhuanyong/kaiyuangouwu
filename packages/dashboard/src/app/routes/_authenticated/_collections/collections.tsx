import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import {
    sensitiveActionHeaders,
    SensitiveActionPasswordField,
} from '@/vdb/components/shared/sensitive-action-password.js';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/vdb/components/ui/alert-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
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
import { ChevronRight, Folder, FolderOpen, Loader2, Pencil, PlusIcon, Trash2 } from 'lucide-react';
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
    deleteCollectionDocument,
    moveCollectionDocument,
} from './collections.graphql.js';
import { CollectionContentsSheet } from './components/collection-contents-sheet.js';
import {
    CollectionQuickCreateParent,
    CollectionQuickCreateSheet,
} from './components/collection-quick-create-sheet.js';
import { updateCollectionVisibility } from './components/collection-visibility-state.js';
import {
    CollectionVisibilitySwitch,
    CollectionVisibilityValue,
} from './components/collection-visibility-switch.js';

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

type ChildCollectionQueryData = {
    collectionId: string;
    items: Collection[];
    totalItems: number;
};

function isLoadMoreRow(row: CollectionOrLoadMore): row is LoadMoreRow {
    return '_isLoadMore' in row && row._isLoadMore === true;
}

function CollectionDeleteButton({
    collection,
    onDeleted,
}: Readonly<{
    collection: Collection;
    onDeleted: () => Promise<void>;
}>) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [password, setPassword] = useState('');
    const hasChildren = Boolean(collection.children?.length);

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const result = await api.mutate(
                deleteCollectionDocument,
                { id: collection.id },
                sensitiveActionHeaders(password),
            );
            if (result.deleteCollection.result !== 'DELETED') {
                toast.error(t`Failed to delete`, {
                    description: result.deleteCollection.message,
                });
                return;
            }

            await onDeleted();
            toast.success(t`Deleted successfully`);
            setPassword('');
            setOpen(false);
        } catch (error) {
            toast.error(t`Failed to delete`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <AlertDialog
            open={open}
            onOpenChange={
                isDeleting
                    ? undefined
                    : nextOpen => {
                          setOpen(nextOpen);
                          if (!nextOpen) setPassword('');
                      }
            }
        >
            <AlertDialogTrigger
                render={
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" />
                }
            >
                <Trash2 className="h-4 w-4" /> <Trans>Delete</Trans>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <Trans>Confirm deletion</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {hasChildren ? (
                            <Trans>
                                Deleting a parent product group also permanently deletes all of its child
                                product groups. Are you sure you want to continue?
                            </Trans>
                        ) : (
                            <Trans>
                                Are you sure you want to delete this item? This action cannot be undone.
                            </Trans>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <SensitiveActionPasswordField value={password} onChange={setPassword} disabled={isDeleting} />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>
                        <Trans>Cancel</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isDeleting || !password}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={event => {
                            event.preventDefault();
                            void handleDelete();
                        }}
                    >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        <Trans>Delete</Trans>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
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

    const handleVisibilityUpdated = useCallback(
        ({ id, isPrivate }: CollectionVisibilityValue) => {
            queryClient.setQueriesData<ResultOf<typeof collectionListDocument>>(
                { queryKey: ['PaginatedListDataTable'] },
                cachedData => {
                    if (!cachedData?.collections?.items) {
                        return cachedData;
                    }
                    const items = updateCollectionVisibility(cachedData.collections.items, id, isPrivate);
                    if (items === cachedData.collections.items) {
                        return cachedData;
                    }
                    return {
                        ...cachedData,
                        collections: {
                            ...cachedData.collections,
                            items,
                        },
                    };
                },
            );
            queryClient.setQueriesData<ChildCollectionQueryData>(
                { queryKey: ['childCollections'] },
                cachedData => {
                    if (!cachedData) {
                        return cachedData;
                    }
                    const items = updateCollectionVisibility(cachedData.items, id, isPrivate);
                    return items === cachedData.items ? cachedData : { ...cachedData, items };
                },
            );
            setAccumulatedChildren(current => {
                let hasUpdates = false;
                const updatedEntries = Object.entries(current).map(([parentId, childData]) => {
                    const items = updateCollectionVisibility(childData.items, id, isPrivate);
                    if (items === childData.items) {
                        return [parentId, childData] as const;
                    }
                    hasUpdates = true;
                    return [parentId, { ...childData, items }] as const;
                });
                return hasUpdates ? Object.fromEntries(updatedEntries) : current;
            });
            void queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
        },
        [queryClient],
    );

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
                toast.error(
                    t`Collections can only have two levels and cannot be moved below a second-level collection`,
                );
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
                        header: () => <Trans>Collection name</Trans>,
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
                                        <span className="truncate">{original.name}</span>
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
                                                    aria-label={t`Add a second-level collection under ${original.name}`}
                                                >
                                                    <PlusIcon className="h-4 w-4" />
                                                    <span className="hidden @xl:inline">
                                                        <Trans>Add second-level collection</Trans>
                                                    </span>
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
                        header: () => <Trans>Product count</Trans>,
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
                        header: () => <Trans>Storefront visibility</Trans>,
                        cell: ({ row }) => (
                            <CollectionVisibilitySwitch
                                collection={row.original}
                                onVisibilityUpdated={handleVisibilityUpdated}
                            />
                        ),
                    },
                    position: {
                        header: () => <Trans>Order</Trans>,
                        cell: ({ row }) => <span className="tabular-nums">{row.original.position + 1}</span>,
                    },
                }}
                additionalColumns={{
                    level: {
                        meta: { dependencies: ['breadcrumbs'] },
                        header: () => <Trans>Level</Trans>,
                        cell: ({ row }) => (
                            <Badge variant="outline">
                                {row.original.breadcrumbs.length === 2
                                    ? t`Top-level collection`
                                    : t`Second-level collection`}
                            </Badge>
                        ),
                        enableSorting: false,
                    },
                    operation: {
                        meta: { dependencies: ['id', 'children'] },
                        header: () => <Trans>Actions</Trans>,
                        cell: ({ row }) => (
                            <div className="flex items-center gap-1">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    render={<Link to="./$id" params={{ id: row.original.id }} />}
                                >
                                    <Pencil className="h-4 w-4" /> <Trans>Edit</Trans>
                                </Button>
                                <PermissionGuard requires={['DeleteCollection', 'DeleteCatalog']}>
                                    <CollectionDeleteButton
                                        collection={row.original}
                                        onDeleted={async () => {
                                            queryClient.removeQueries({ queryKey: ['childCollections'] });
                                            queryClient.removeQueries({ queryKey: ['collection-tree'] });
                                            queryClient.removeQueries({
                                                queryKey: ['collection-tree-children'],
                                            });
                                            setAccumulatedChildren({});
                                            setExpanded(current => {
                                                if (current === true || !current[row.original.id]) {
                                                    return current;
                                                }
                                                const next = { ...current };
                                                delete next[row.original.id];
                                                return next;
                                            });
                                            await queryClient.invalidateQueries({
                                                queryKey: ['PaginatedListDataTable'],
                                            });
                                        }}
                                    />
                                </PermissionGuard>
                            </div>
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
                searchPlaceholder={t`Search collection names...`}
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
                    <p className="text-sm text-muted-foreground">
                        <Trans>Manage the product groups displayed in the storefront</Trans>
                    </p>
                </PageActionBarLeft>
                <ActionBarItem
                    itemId="create-button"
                    requiresPermission={['CreateCollection', 'CreateCatalog']}
                >
                    <Button onClick={() => openQuickCreate()}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>Add top-level collection</Trans>
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
