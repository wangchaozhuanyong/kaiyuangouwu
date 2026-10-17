import { createFileRoute } from '@tanstack/react-router';

import { RegisterRoutePage } from '../route-pages/auth-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/register')({
    loader: storefrontRouteCodeLoader,
    component: RegisterRoutePage,
});
