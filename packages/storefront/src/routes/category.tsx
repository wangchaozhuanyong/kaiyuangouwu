import { createFileRoute } from '@tanstack/react-router';

import { CategoryRoutePage } from '../route-pages/catalog-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/category')({
    validateSearch: normalizeRouteSearch,
    component: CategoryRoutePage,
});
