import { createFileRoute } from '@tanstack/react-router';

import { CheckoutPageRoute } from '../route-pages/checkout-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/checkout')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: CheckoutPageRoute,
});
