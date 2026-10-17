import { createFileRoute } from '@tanstack/react-router';

import { OrderConfirmationRoutePage } from '../route-pages/checkout-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/order-confirmation')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: OrderConfirmationRoutePage,
});
