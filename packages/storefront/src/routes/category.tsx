import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { CategoryRoutePage } from '../route-pages/category-route-page';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/category')({
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
    component: CategoryRoutePage,
});
