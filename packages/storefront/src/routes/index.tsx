import { createFileRoute } from '@tanstack/react-router';

import { HomeRoutePage } from '../route-pages/catalog-route-pages';
import { publicPageRouteLoader } from '../storefront-page-data';

export const Route = createFileRoute('/')({
    loader: publicPageRouteLoader,
    component: HomeRoutePage,
});
