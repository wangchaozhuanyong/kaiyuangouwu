import { createFileRoute } from '@tanstack/react-router';

import { AddressesRoutePage } from '../route-pages/order-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/addresses')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: AddressesRoutePage,
});
