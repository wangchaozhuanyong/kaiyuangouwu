import { createFileRoute } from '@tanstack/react-router';

import { TwoFactorRoutePage } from '../route-pages/content-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/two-factor')({
    loader: storefrontRouteCodeLoader,
    component: TwoFactorRoutePage,
});
