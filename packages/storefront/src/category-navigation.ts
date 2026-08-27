interface HorizontalScrollContainerMetrics {
    clientWidth: number;
    scrollWidth: number;
}

interface HorizontalScrollItemMetrics {
    offsetLeft: number;
    offsetWidth: number;
}

export function centeredHorizontalScrollLeft(
    container: HorizontalScrollContainerMetrics,
    item: HorizontalScrollItemMetrics,
): number {
    const maximumScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const centeredScrollLeft = item.offsetLeft - (container.clientWidth - item.offsetWidth) / 2;
    return Math.min(maximumScrollLeft, Math.max(0, centeredScrollLeft));
}
