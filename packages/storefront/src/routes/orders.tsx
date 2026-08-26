import { createFileRoute } from '@tanstack/react-router';

import { OrdersRoutePage } from '../route-pages/order-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/orders')({
    validateSearch: normalizeRouteSearch,
    component: OrdersRoutePage,
});
