import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { HomeRoutePage } from '../route-pages/catalog-route-pages';
import { prefetchPublicPage } from '../storefront-page-data';

export const Route = createFileRoute('/')({
    loader: ({ location, abortController }) =>
        // This only warms data. The mounted page's Query owns success, empty and error UI.
        prefetchPublicPage(storefrontQueryClient, location.publicHref, abortController.signal).catch(
            () => undefined,
        ),
    component: HomeRoutePage,
});
