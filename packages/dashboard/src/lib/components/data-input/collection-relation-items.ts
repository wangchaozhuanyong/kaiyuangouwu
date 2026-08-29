export interface CollectionRelationBreadcrumb {
    id: string;
    name: string;
}

export interface CollectionRelationItem {
    id: string;
    name: string;
    position: number;
    parent?: {
        id: string;
        name: string;
        position: number;
    } | null;
    breadcrumbs: CollectionRelationBreadcrumb[];
}

export function collectionRelationDepth(item: CollectionRelationItem): number {
    return Math.max(0, item.breadcrumbs.length - 1);
}

export function collectionRelationPath(item: CollectionRelationItem): string {
    const names = item.breadcrumbs
        .slice(1)
        .map(breadcrumb => breadcrumb.name.trim())
        .filter(Boolean);
    return names.length > 0 ? names.join(' / ') : item.name;
}

export function compareCollectionRelationItems(
    first: CollectionRelationItem,
    second: CollectionRelationItem,
): number {
    const firstDepth = collectionRelationDepth(first);
    const secondDepth = collectionRelationDepth(second);
    const firstGroupPosition = firstDepth === 2 ? (first.parent?.position ?? first.position) : first.position;
    const secondGroupPosition =
        secondDepth === 2 ? (second.parent?.position ?? second.position) : second.position;

    return (
        firstGroupPosition - secondGroupPosition ||
        firstDepth - secondDepth ||
        first.position - second.position ||
        collectionRelationPath(first).localeCompare(collectionRelationPath(second), undefined, {
            numeric: true,
            sensitivity: 'base',
        }) ||
        first.id.localeCompare(second.id)
    );
}

export function isSelectableCollectionRelationItem(item: CollectionRelationItem): boolean {
    const depth = collectionRelationDepth(item);
    return depth === 1 || depth === 2;
}
