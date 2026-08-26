import { createFileRoute } from '@tanstack/react-router';

import { OrderConfirmationRoutePage } from '../route-pages/checkout-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/order-confirmation')({
    validateSearch: normalizeRouteSearch,
    component: OrderConfirmationRoutePage,
});
