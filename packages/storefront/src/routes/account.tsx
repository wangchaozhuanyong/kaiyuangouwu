import { createFileRoute } from '@tanstack/react-router';

import { AccountRoutePage } from '../route-pages/account-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/account')({
    loader: storefrontRouteCodeLoader,
    component: AccountRoutePage,
});
