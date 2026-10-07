import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { SearchRoutePage } from '../route-pages/catalog-route-pages';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/search')({
    validateSearch: normalizeRouteSearch,
    loader: ({ location }) => prefetchPublicPage(storefrontQueryClient, location.href).catch(() => undefined),
    component: SearchRoutePage,
});
