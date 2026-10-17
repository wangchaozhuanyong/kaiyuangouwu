import { createFileRoute } from '@tanstack/react-router';

import { MailQueryRoutePage } from '../route-pages/content-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/mail-query')({
    loader: storefrontRouteCodeLoader,
    component: MailQueryRoutePage,
});
