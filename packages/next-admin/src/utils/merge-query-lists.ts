/** Merge only lists that were selected by the current page's GraphQL document. */
export function mergeQueryLists<T>(previous: T, next: T, keys: readonly string[]): T {
    const result = { ...previous, ...next } as Record<string, unknown>;
    for (const key of keys) {
        const before = (previous as Record<string, unknown>)[key] as
            { items?: Array<{ id: string }> } | undefined;
        const after = (next as Record<string, unknown>)[key] as { items?: Array<{ id: string }> } | undefined;
        if (!after?.items) continue;
        result[key] = {
            ...after,
            items: [
                ...new Map([...(before?.items ?? []), ...after.items].map(item => [item.id, item])).values(),
            ],
        };
    }
    return result as T;
}
