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

export const CATEGORY_SCROLL_DURATION_MS = 480;

/** A click moves only this rail; native snap stays available for manual browsing. */
export function animateCategoryScroll(container: HTMLElement, destination: number): () => void {
    const start = container.scrollLeft;
    const reduceMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || Math.abs(destination - start) < 1) {
        container.scrollLeft = destination;
        return () => undefined;
    }

    const properties = ['scroll-snap-type', 'scroll-behavior'] as const;
    const previous = properties.map(property => ({
        property,
        value: container.style.getPropertyValue(property),
        priority: container.style.getPropertyPriority(property),
    }));
    container.style.setProperty('scroll-snap-type', 'none');
    container.style.setProperty('scroll-behavior', 'auto');
    let active = true;
    let frame: number;
    const startedAt = performance.now();
    const stop = () => {
        if (!active) return;
        active = false;
        cancelAnimationFrame(frame);
        for (const { property, value, priority } of previous) {
            if (value) container.style.setProperty(property, value, priority);
            else container.style.removeProperty(property);
        }
    };
    const step = (now: number) => {
        if (!active) return;
        const progress = Math.min(1, Math.max(0, (now - startedAt) / CATEGORY_SCROLL_DURATION_MS));
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        container.scrollLeft = start + (destination - start) * eased;
        if (progress < 1) frame = requestAnimationFrame(step);
        else stop();
    };
    frame = requestAnimationFrame(step);
    return stop;
}
