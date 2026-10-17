import { createFileRoute } from '@tanstack/react-router';

import { PaymentRoutePage } from '../route-pages/checkout-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/payment')({
    loader: storefrontRouteCodeLoader,
    component: PaymentRoutePage,
});
