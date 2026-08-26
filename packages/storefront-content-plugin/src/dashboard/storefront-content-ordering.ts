interface StoredContentBlock {
    id?: string;
}

/**
 * Swaps two persisted blocks while keeping every other content block in place.
 * The Admin API requires a complete list of block IDs even when the UI only
 * displays one subset, such as homepage carousel slides.
 */
export function swappedContentBlockIds(
    blocks: StoredContentBlock[],
    firstId: string | undefined,
    secondId: string | undefined,
): string[] {
    const ids = blocks.flatMap(block => (block.id ? [block.id] : []));
    if (!firstId || !secondId) return ids;

    const firstIndex = ids.indexOf(firstId);
    const secondIndex = ids.indexOf(secondId);
    if (firstIndex === -1 || secondIndex === -1) return ids;

    [ids[firstIndex], ids[secondIndex]] = [ids[secondIndex], ids[firstIndex]];
    return ids;
}
