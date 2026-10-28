import { createFileRoute } from '@tanstack/react-router';

import { SearchRoutePage } from '../route-pages/catalog-detail-route-pages';
import { publicPageRouteLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/search')({
    validateSearch: normalizeRouteSearch,
    loaderDeps: ({ search }) => ({
        ...search,
        auth: undefined,
        authTarget: undefined,
    }),
    loader: publicPageRouteLoader,
    component: SearchRoutePage,
});
