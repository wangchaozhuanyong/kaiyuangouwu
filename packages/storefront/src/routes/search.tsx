import { createFileRoute } from '@tanstack/react-router';

import { SearchRoutePage } from '../route-pages/catalog-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/search')({
    validateSearch: normalizeRouteSearch,
    component: SearchRoutePage,
});
