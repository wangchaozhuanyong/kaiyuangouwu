import { createFileRoute } from '@tanstack/react-router';

import { CartRoutePage } from '../route-pages/cart-route-page';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/cart')({
    loader: storefrontRouteCodeLoader,
    component: CartRoutePage,
});
