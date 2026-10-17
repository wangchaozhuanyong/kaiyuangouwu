import { createFileRoute } from '@tanstack/react-router';

import { LoginRoutePage } from '../route-pages/auth-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/login')({
    loader: storefrontRouteCodeLoader,
    component: LoginRoutePage,
});
