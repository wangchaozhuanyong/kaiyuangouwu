import { createFileRoute } from '@tanstack/react-router';

import { FavoritesRoutePage } from '../route-pages/account-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/favorites')({
    loader: storefrontRouteCodeLoader,
    component: FavoritesRoutePage,
});
