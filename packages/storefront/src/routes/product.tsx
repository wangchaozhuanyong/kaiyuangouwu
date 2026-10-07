import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { ProductRoutePage } from '../route-pages/catalog-route-pages';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/product')({
    validateSearch: normalizeRouteSearch,
    loader: ({ location }) => prefetchPublicPage(storefrontQueryClient, location.href).catch(() => undefined),
    component: ProductRoutePage,
});
