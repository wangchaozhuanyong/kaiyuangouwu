import type { ImageStudioCacheEntry } from './ai-image-studio-cache';

// Session invalidation stays synchronous without importing the optional studio
// draft/configuration/prefetch implementation into every storefront entry.
export const studioCacheState = {
    entries: new Map<string, ImageStudioCacheEntry>(),
    activePreloads: new Map<string, Promise<void>>(),
    generation: 0,
};

export function clearStudioCache(): void {
    studioCacheState.generation += 1;
    studioCacheState.entries.clear();
    studioCacheState.activePreloads.clear();
}
