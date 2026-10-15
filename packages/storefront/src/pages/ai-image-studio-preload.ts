import type { ShopApi } from '../api';
import type { ActiveCustomer, MarketConfig } from '../types';

import { studioCacheState } from './ai-image-studio-cache-state';

/** Optional plugin warmup must not load the studio on unconfigured catalog pages. */
export function prepareImageStudioData(
    api: ShopApi,
    customer: ActiveCustomer | null,
    market: MarketConfig,
    isCurrent: () => boolean,
): void {
    const generation = studioCacheState.generation;
    void import('./ai-image-studio-cache')
        .then(module => {
            // Importing may finish after logout or a different plugin/store scope.
            // Reject that intent before the old account can start any request.
            if (generation === studioCacheState.generation && isCurrent())
                return module.preloadImageStudioData(api, customer, market);
        })
        .catch(() => undefined);
}
