import { createFileRoute } from '@tanstack/react-router';

import { PurchaseRoutePage } from '../route-pages/checkout-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/purchase')({
    validateSearch: normalizeRouteSearch,
    component: PurchaseRoutePage,
});
