import { createFileRoute } from '@tanstack/react-router';

import { CategoryRoutePage } from '../route-pages/category-route-page';
import { publicPageRouteLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/category')({
    validateSearch: normalizeRouteSearch,
    loaderDeps: ({ search }) => ({
        ...search,
        auth: undefined,
        authTarget: undefined,
    }),
    loader: publicPageRouteLoader,
    component: CategoryRoutePage,
});
