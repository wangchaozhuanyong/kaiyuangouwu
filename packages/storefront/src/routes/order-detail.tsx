import { createFileRoute } from '@tanstack/react-router';

import { OrderDetailRoutePage } from '../route-pages/order-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/order-detail')({
    validateSearch: normalizeRouteSearch,
    component: OrderDetailRoutePage,
});
