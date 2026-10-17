import { createFileRoute } from '@tanstack/react-router';

import { PurchaseRoutePage } from '../route-pages/checkout-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/purchase')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: PurchaseRoutePage,
});
