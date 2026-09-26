import { createMemoryHistory, createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export { QueryClientProvider } from '@tanstack/react-query';
export { RouterProvider } from '@tanstack/react-router';

// Use the same route tree without replacing the Admin's document URL.
export function createStorefrontPreviewRouter(initialRoute: string) {
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialRoute] }) });
}
