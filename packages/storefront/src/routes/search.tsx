import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { SearchRoutePage } from '../route-pages/catalog-route-pages';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/search')({
    validateSearch: normalizeRouteSearch,
    loaderDeps: ({ search }) => ({
        ...search,
        auth: undefined,
        authTarget: undefined,
    }),
    loader: ({ location, abortController }) =>
        // This only warms data. The mounted page's Query owns success, empty and error UI.
        prefetchPublicPage(storefrontQueryClient, location.publicHref, abortController.signal).catch(
            () => undefined,
        ),
    component: SearchRoutePage,
});
