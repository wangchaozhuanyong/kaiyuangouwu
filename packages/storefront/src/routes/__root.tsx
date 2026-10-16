import { createRootRoute } from '@tanstack/react-router';

import { App } from '../App';
import { NotFoundRoutePage } from '../not-found-route-page';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createRootRoute({
    pendingMs: Infinity,
    shouldReload: true,
    preload: false,
    loaderDeps: ({ search }: { search: Record<string, unknown> }) => [
        search.__route,
        search.__storefrontLanguage,
    ],
    loader: { handler: storefrontRouteCodeLoader, staleReloadMode: 'blocking' },
    component: App,
    notFoundComponent: NotFoundRoutePage,
});
