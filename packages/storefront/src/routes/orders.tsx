import { createFileRoute } from '@tanstack/react-router';

import { OrdersRoutePage } from '../route-pages/order-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/orders')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: OrdersRoutePage,
});
