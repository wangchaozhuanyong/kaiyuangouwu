import { createFileRoute } from '@tanstack/react-router';

import { AddressesRoutePage } from '../route-pages/order-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/addresses')({
    validateSearch: normalizeRouteSearch,
    component: AddressesRoutePage,
});
