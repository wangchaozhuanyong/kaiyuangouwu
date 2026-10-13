import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { ProductRoutePage } from '../route-pages/catalog-route-pages';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/product')({
    validateSearch: normalizeRouteSearch,
    loaderDeps: ({ search }) => ({
        id: search.id,
        language: search.__storefrontLanguage,
    }),
    loader: ({ location, abortController }) =>
        // This only warms data. The mounted page's Query owns success, empty and error UI.
        prefetchPublicPage(storefrontQueryClient, location.publicHref, abortController.signal).catch(
            () => undefined,
        ),
    component: ProductRoutePage,
});
