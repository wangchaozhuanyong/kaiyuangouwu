import { createFileRoute } from '@tanstack/react-router';

import { NotificationsRoutePage } from '../route-pages/account-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/notifications')({
    loader: storefrontRouteCodeLoader,
    component: NotificationsRoutePage,
});
