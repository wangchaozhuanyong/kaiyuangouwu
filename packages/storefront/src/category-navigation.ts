interface HorizontalScrollContainerMetrics {
    clientWidth: number;
    scrollWidth: number;
}

interface HorizontalScrollItemMetrics {
    offsetLeft: number;
    offsetWidth: number;
}

interface CategoryTargetCollection {
    id: string;
    children?: readonly CategoryTargetCollection[] | null;
}

export interface CategoryTargetSelection {
    collectionId: string;
    childId: string;
}

export function categoryTargetSelection(
    collections: readonly CategoryTargetCollection[],
    targetId: string,
): CategoryTargetSelection {
    const topLevelCollection = collections.find(collection => collection.id === targetId);
    if (topLevelCollection) {
        return { collectionId: topLevelCollection.id, childId: 'all' };
    }

    const parentCollection = collections.find(collection =>
        collection.children?.some(child => child.id === targetId),
    );
    if (parentCollection) {
        return { collectionId: parentCollection.id, childId: targetId };
    }

    return { collectionId: targetId, childId: targetId };
}

export function centeredHorizontalScrollLeft(
    container: HorizontalScrollContainerMetrics,
    item: HorizontalScrollItemMetrics,
): number {
    const maximumScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const centeredScrollLeft = item.offsetLeft - (container.clientWidth - item.offsetWidth) / 2;
    return Math.min(maximumScrollLeft, Math.max(0, centeredScrollLeft));
}
