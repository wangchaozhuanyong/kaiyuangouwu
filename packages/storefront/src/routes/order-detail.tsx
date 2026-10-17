import { createFileRoute } from '@tanstack/react-router';

import { OrderDetailRoutePage } from '../route-pages/order-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/order-detail')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: OrderDetailRoutePage,
});
