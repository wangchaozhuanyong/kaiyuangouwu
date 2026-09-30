import { createFileRoute } from '@tanstack/react-router';

import { LogisticsRoutePage } from '../route-pages/order-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/logistics')({
    validateSearch: normalizeRouteSearch,
    component: LogisticsRoutePage,
});
