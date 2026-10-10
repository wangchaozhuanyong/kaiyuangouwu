import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { CategoryRoutePage } from '../route-pages/category-route-page';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/category')({
    validateSearch: normalizeRouteSearch,
    loader: ({ location }) =>
        prefetchPublicPage(storefrontQueryClient, location.publicHref).catch(() => undefined),
    component: CategoryRoutePage,
});
