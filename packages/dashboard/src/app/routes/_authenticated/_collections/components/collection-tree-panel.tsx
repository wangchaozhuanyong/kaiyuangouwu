import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { api } from '@/vdb/graphql/api.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import {
    Check,
    ChevronDown,
    ChevronRight,
    CornerDownRight,
    Folder,
    FolderOpen,
    Plus,
    Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { collectionListForMoveDocument } from '../collections.graphql.js';

type CollectionTreeItem = {
    id: string;
    name: string;
    slug: string;
    parentId?: string | null;
    productVariantCount?: number;
    children?: Array<{ id: string }> | null;
    breadcrumbs: Array<{ id: string; name: string; slug: string }>;
};

export interface CollectionTreePanelProps {
    selectedParentId?: string;
    currentCollectionId?: string;
    onSelectParent: (collectionId: string | undefined) => void;
    onAddChild: (collectionId: string) => void;
    onOpenCollection?: (collectionId: string) => void;
    onRootCollectionIdChange?: (rootCollectionId: string | undefined) => void;
}

const PAGE_SIZE = 100;

function isUnavailableParent(collection: CollectionTreeItem, currentCollectionId?: string) {
    if (collection.breadcrumbs.length !== 2) {
        return true;
    }
    if (!currentCollectionId) {
        return false;
    }
    return (
        collection.id === currentCollectionId ||
        collection.breadcrumbs.some(breadcrumb => breadcrumb.id === currentCollectionId)
    );
}

export function CollectionTreePanel({
    selectedParentId,
    currentCollectionId,
    onSelectParent,
    onAddChild,
    onOpenCollection,
    onRootCollectionIdChange,
}: Readonly<CollectionTreePanelProps>) {
    const { t } = useLingui();
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm.trim(), 250);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const { data, isLoading, isError } = useQuery({
        queryKey: ['collection-tree', debouncedSearchTerm],
        queryFn: () =>
            api.query(collectionListForMoveDocument, {
                options: {
                    take: PAGE_SIZE,
                    topLevelOnly: !debouncedSearchTerm,
                    ...(debouncedSearchTerm
                        ? {
                              filter: {
                                  name: { contains: debouncedSearchTerm },
                              },
                          }
                        : {}),
                },
            }),
        staleTime: 1000 * 60 * 5,
    });

    const collections = (data?.collections.items ?? []) as CollectionTreeItem[];
    const rootCollectionId = collections[0]?.parentId ?? undefined;

    useEffect(() => {
        if (!debouncedSearchTerm) {
            onRootCollectionIdChange?.(rootCollectionId ?? undefined);
        }
    }, [debouncedSearchTerm, onRootCollectionIdChange, rootCollectionId]);

    const expandedIds = useMemo(
        () =>
            Object.entries(expanded)
                .filter(([, isExpanded]) => isExpanded)
                .map(([id]) => id),
        [expanded],
    );

    const childQueries = useQueries({
        queries: expandedIds.map(collectionId => ({
            queryKey: ['collection-tree-children', collectionId],
            queryFn: () =>
                api.query(collectionListForMoveDocument, {
                    options: {
                        take: PAGE_SIZE,
                        filter: {
                            parentId: { eq: collectionId },
                        },
                    },
                }),
            staleTime: 1000 * 60 * 5,
        })),
    });

    const childCollectionsByParentId = useMemo(() => {
        return expandedIds.reduce<Record<string, CollectionTreeItem[]>>((result, collectionId, index) => {
            result[collectionId] =
                (childQueries[index]?.data?.collections.items as CollectionTreeItem[] | undefined) ?? [];
            return result;
        }, {});
    }, [childQueries, expandedIds]);

    const childQueryStateByParentId = useMemo(() => {
        return expandedIds.reduce<Record<string, 'loading' | 'error' | 'success'>>(
            (result, collectionId, index) => {
                const query = childQueries[index];
                result[collectionId] = query?.isError ? 'error' : query?.isPending ? 'loading' : 'success';
                return result;
            },
            {},
        );
    }, [childQueries, expandedIds]);

    useEffect(() => {
        const relevantIds = new Set([currentCollectionId, selectedParentId].filter(Boolean));
        const idsToExpand = collections
            .filter(collection => relevantIds.has(collection.id) && Boolean(collection.children?.length))
            .map(collection => collection.id);

        if (idsToExpand.length === 0) {
            return;
        }

        setExpanded(current => {
            if (idsToExpand.every(id => current[id])) {
                return current;
            }
            return idsToExpand.reduce((next, id) => ({ ...next, [id]: true }), current);
        });
    }, [collections, currentCollectionId, selectedParentId]);

    const toggleExpanded = (collectionId: string) => {
        setExpanded(current => ({
            ...current,
            [collectionId]: !current[collectionId],
        }));
    };

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    value={searchTerm}
                    onChange={event => setSearchTerm(event.target.value)}
                    placeholder={t`Search collections...`}
                    aria-label={t`Search collections`}
                    className="pl-9"
                />
            </div>

            <div className="max-h-64 min-h-40 overflow-y-auto pr-1 md:max-h-[calc(100vh-15rem)] md:min-h-72">
                {isLoading ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        <Trans>Loading product groups...</Trans>
                    </div>
                ) : isError ? (
                    <div className="py-8 text-center text-sm text-destructive">
                        <Trans>Failed to load product groups</Trans>
                    </div>
                ) : collections.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        <Trans>No product groups found</Trans>
                    </div>
                ) : debouncedSearchTerm ? (
                    <div className="space-y-1">
                        {collections.map(collection => (
                            <SearchResultRow
                                key={collection.id}
                                collection={collection}
                                selectedParentId={selectedParentId}
                                currentCollectionId={currentCollectionId}
                                onSelectParent={onSelectParent}
                                onAddChild={onAddChild}
                                onOpenCollection={onOpenCollection}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-1">
                        <button
                            type="button"
                            className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                                selectedParentId == null ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60',
                            )}
                            onClick={() => onSelectParent(undefined)}
                        >
                            <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="font-medium">
                                <Trans>No parent collection</Trans>
                            </span>
                        </button>
                        {collections.map(collection => (
                            <CollectionTreeNode
                                key={collection.id}
                                collection={collection}
                                depth={0}
                                expanded={expanded}
                                childCollectionsByParentId={childCollectionsByParentId}
                                childQueryStateByParentId={childQueryStateByParentId}
                                selectedParentId={selectedParentId}
                                currentCollectionId={currentCollectionId}
                                onToggleExpanded={toggleExpanded}
                                onSelectParent={onSelectParent}
                                onAddChild={onAddChild}
                                onOpenCollection={onOpenCollection}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function SearchResultRow({
    collection,
    selectedParentId,
    currentCollectionId,
    onSelectParent,
    onAddChild,
    onOpenCollection,
}: Readonly<{
    collection: CollectionTreeItem;
    selectedParentId?: string;
    currentCollectionId?: string;
    onSelectParent: (collectionId: string | undefined) => void;
    onAddChild: (collectionId: string) => void;
    onOpenCollection?: (collectionId: string) => void;
}>) {
    const { t } = useLingui();
    const unavailable = isUnavailableParent(collection, currentCollectionId);
    const canAddChild = collection.breadcrumbs.length === 2;
    const path = collection.breadcrumbs
        .slice(1)
        .map(breadcrumb => breadcrumb.name)
        .join(' / ');

    return (
        <div
            className={cn(
                'group rounded-md border border-transparent px-2 py-2 transition-colors',
                selectedParentId === collection.id ? 'border-primary/40 bg-primary/10' : 'hover:bg-muted/60',
                unavailable && !onOpenCollection && 'opacity-50',
            )}
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() =>
                        onOpenCollection ? onOpenCollection(collection.id) : onSelectParent(collection.id)
                    }
                    disabled={onOpenCollection ? collection.id === currentCollectionId : unavailable}
                >
                    <div className="truncate text-sm font-medium">{collection.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{path}</div>
                </button>
                {onOpenCollection && canAddChild && !unavailable ? (
                    <Button
                        type="button"
                        variant={selectedParentId === collection.id ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        onClick={() => onSelectParent(collection.id)}
                        aria-label={t`Select ${collection.name}`}
                        title={t`Select ${collection.name}`}
                    >
                        {selectedParentId === collection.id ? (
                            <Check className="h-4 w-4" />
                        ) : (
                            <CornerDownRight className="h-4 w-4" />
                        )}
                    </Button>
                ) : null}
                {canAddChild ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onAddChild(collection.id)}
                        aria-label={t`Add a second-level collection under ${collection.name}`}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                        <Trans>Second-level collection</Trans>
                    </span>
                )}
            </div>
        </div>
    );
}

function CollectionTreeNode({
    collection,
    depth,
    expanded,
    childCollectionsByParentId,
    childQueryStateByParentId,
    selectedParentId,
    currentCollectionId,
    onToggleExpanded,
    onSelectParent,
    onAddChild,
    onOpenCollection,
}: Readonly<{
    collection: CollectionTreeItem;
    depth: number;
    expanded: Record<string, boolean>;
    childCollectionsByParentId: Record<string, CollectionTreeItem[]>;
    childQueryStateByParentId: Record<string, 'loading' | 'error' | 'success'>;
    selectedParentId?: string;
    currentCollectionId?: string;
    onToggleExpanded: (collectionId: string) => void;
    onSelectParent: (collectionId: string | undefined) => void;
    onAddChild: (collectionId: string) => void;
    onOpenCollection?: (collectionId: string) => void;
}>) {
    const { t } = useLingui();
    const isExpanded = expanded[collection.id] === true;
    const hasChildren = Boolean(collection.children?.length);
    const children = childCollectionsByParentId[collection.id] ?? [];
    const unavailable = isUnavailableParent(collection, currentCollectionId);
    const isSelected = selectedParentId === collection.id;
    const isTopLevel = depth === 0 && collection.breadcrumbs.length === 2;

    return (
        <div>
            <div
                className={cn(
                    'group flex items-center rounded-md transition-colors',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60',
                    unavailable && !onOpenCollection && 'opacity-50',
                )}
                style={{ paddingLeft: `${depth * 16}px` }}
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() => onToggleExpanded(collection.id)}
                    disabled={!hasChildren || !isTopLevel}
                    aria-label={isExpanded ? t`Collapse` : t`Expand`}
                >
                    {hasChildren ? (
                        isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                        ) : (
                            <ChevronRight className="h-4 w-4" />
                        )
                    ) : (
                        <span className="h-4 w-4" />
                    )}
                </Button>
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-1 text-left text-sm"
                    onClick={() =>
                        onOpenCollection ? onOpenCollection(collection.id) : onSelectParent(collection.id)
                    }
                    disabled={
                        onOpenCollection ? collection.id === currentCollectionId : unavailable || !isTopLevel
                    }
                >
                    {isExpanded ? (
                        <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                        <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate font-medium">{collection.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {collection.productVariantCount ?? 0}
                    </span>
                </button>
                {onOpenCollection && isTopLevel && !unavailable ? (
                    <Button
                        type="button"
                        variant={isSelected ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        className="shrink-0"
                        onClick={() => onSelectParent(collection.id)}
                        aria-label={t`Select ${collection.name}`}
                        title={t`Select ${collection.name}`}
                    >
                        {isSelected ? <Check className="h-4 w-4" /> : <CornerDownRight className="h-4 w-4" />}
                    </Button>
                ) : null}
                {isTopLevel ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => onAddChild(collection.id)}
                        aria-label={t`Add a second-level collection under ${collection.name}`}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                ) : (
                    <span className="mr-2 shrink-0 text-xs text-muted-foreground">
                        <Trans>Second level</Trans>
                    </span>
                )}
            </div>
            {isExpanded && hasChildren && childQueryStateByParentId[collection.id] === 'loading' ? (
                <div
                    className="py-2 pr-2 text-xs text-muted-foreground"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 32}px` }}
                >
                    <Trans>Loading product groups...</Trans>
                </div>
            ) : null}
            {isExpanded && hasChildren && childQueryStateByParentId[collection.id] === 'error' ? (
                <div
                    className="py-2 pr-2 text-xs text-destructive"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 32}px` }}
                >
                    <Trans>Failed to load product groups</Trans>
                </div>
            ) : null}
            {isExpanded &&
            hasChildren &&
            childQueryStateByParentId[collection.id] === 'success' &&
            children.length === 0 ? (
                <div
                    className="py-2 pr-2 text-xs text-muted-foreground"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 32}px` }}
                >
                    <Trans>No product groups found</Trans>
                </div>
            ) : null}
            {isExpanded &&
                children.map(child => (
                    <CollectionTreeNode
                        key={child.id}
                        collection={child}
                        depth={depth + 1}
                        expanded={expanded}
                        childCollectionsByParentId={childCollectionsByParentId}
                        childQueryStateByParentId={childQueryStateByParentId}
                        selectedParentId={selectedParentId}
                        currentCollectionId={currentCollectionId}
                        onToggleExpanded={onToggleExpanded}
                        onSelectParent={onSelectParent}
                        onAddChild={onAddChild}
                        onOpenCollection={onOpenCollection}
                    />
                ))}
        </div>
    );
}
