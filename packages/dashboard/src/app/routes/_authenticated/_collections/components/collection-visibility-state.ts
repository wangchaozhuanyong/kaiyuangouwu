export function updateCollectionVisibility<T extends { id: string; isPrivate: boolean }>(
    items: T[],
    id: string,
    isPrivate: boolean,
): T[] {
    const index = items.findIndex(item => item.id === id);
    if (index === -1 || items[index].isPrivate === isPrivate) {
        return items;
    }

    const updatedItems = [...items];
    updatedItems[index] = { ...items[index], isPrivate };
    return updatedItems;
}
