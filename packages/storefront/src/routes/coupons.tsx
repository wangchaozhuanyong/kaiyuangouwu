import { createFileRoute } from '@tanstack/react-router';

import { CouponsRoutePage } from '../route-pages/account-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/coupons')({
    loader: storefrontRouteCodeLoader,
    component: CouponsRoutePage,
});
