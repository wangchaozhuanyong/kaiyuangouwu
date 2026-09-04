import type { CollectionItem } from './product-editor-types';

export interface ProductCollectionGroup {
    parent: CollectionItem;
    children: CollectionItem[];
}

const compareCollections = (left: CollectionItem, right: CollectionItem) =>
    (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
    left.name.localeCompare(right.name);

const matchesCollection = (collection: CollectionItem, searchTerm: string) =>
    collection.name.toLocaleLowerCase().includes(searchTerm) ||
    collection.slug.toLocaleLowerCase().includes(searchTerm);

export function buildProductCollectionGroups(collections: readonly CollectionItem[]) {
    return [...collections].sort(compareCollections).map(({ children, ...parent }) => ({
        parent,
        children: [...(children ?? [])].sort(compareCollections),
    }));
}

export function filterProductCollectionGroups(groups: readonly ProductCollectionGroup[], searchTerm: string) {
    const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
    if (!normalizedSearchTerm) return [...groups];

    return groups.flatMap(group => {
        if (matchesCollection(group.parent, normalizedSearchTerm)) return [group];
        const matchingChildren = group.children.filter(child =>
            matchesCollection(child, normalizedSearchTerm),
        );
        return matchingChildren.length > 0 ? [{ ...group, children: matchingChildren }] : [];
    });
}
