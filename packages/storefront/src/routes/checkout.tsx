import { createFileRoute } from '@tanstack/react-router';

import { CheckoutPageRoute } from '../route-pages/checkout-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/checkout')({
    validateSearch: normalizeRouteSearch,
    component: CheckoutPageRoute,
});
