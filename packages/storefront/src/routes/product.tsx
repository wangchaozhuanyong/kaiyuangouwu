import { createFileRoute } from '@tanstack/react-router';

import { ProductRoutePage } from '../route-pages/catalog-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/product')({
    validateSearch: normalizeRouteSearch,
    component: ProductRoutePage,
});
