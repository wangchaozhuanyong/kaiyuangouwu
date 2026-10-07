import { createFileRoute } from '@tanstack/react-router';

import { storefrontQueryClient } from '../query-client';
import { HomeRoutePage } from '../route-pages/catalog-route-pages';
import { prefetchPublicPage } from '../storefront-page-data';

export const Route = createFileRoute('/')({
    loader: ({ location }) => prefetchPublicPage(storefrontQueryClient, location.href).catch(() => undefined),
    component: HomeRoutePage,
});
