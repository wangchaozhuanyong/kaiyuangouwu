import { createFileRoute } from '@tanstack/react-router';

import { LogisticsRoutePage } from '../route-pages/order-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/logistics')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: LogisticsRoutePage,
});
