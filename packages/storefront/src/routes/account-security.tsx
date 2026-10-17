import { createFileRoute } from '@tanstack/react-router';

import { AccountSecurityRoutePage } from '../route-pages/order-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/account-security')({
    loader: storefrontRouteCodeLoader,
    component: AccountSecurityRoutePage,
});
