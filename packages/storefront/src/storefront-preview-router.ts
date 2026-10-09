import { createMemoryHistory, createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';
import { registerStorefrontNavigationHistory } from './storefront-navigation-history';

export { QueryClientProvider } from '@tanstack/react-query';
export { RouterProvider } from '@tanstack/react-router';

// Use the same route tree without replacing the Admin's document URL.
export function createStorefrontPreviewRouter(initialRoute: string) {
    const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: [initialRoute] }),
    });
    registerStorefrontNavigationHistory(router);
    return router;
}
