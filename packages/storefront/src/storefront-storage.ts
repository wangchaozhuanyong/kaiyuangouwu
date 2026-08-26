export const SEARCH_HISTORY_STORAGE_KEY = 'storefront-search-history';

export function scopedStorageKey(baseKey: string, channelCode: string): string {
    return channelCode ? `${baseKey}:${channelCode}` : '';
}

export function readStoredStrings(storageKey: string, limit: number): string[] {
    if (!storageKey) return [];
    try {
        const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
        return Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string').slice(0, limit)
            : [];
    } catch {
        return [];
    }
}
