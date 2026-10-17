import { createFileRoute } from '@tanstack/react-router';

import { HistoryRoutePage } from '../route-pages/account-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/history')({
    loader: storefrontRouteCodeLoader,
    component: HistoryRoutePage,
});
