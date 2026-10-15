import { createFileRoute } from '@tanstack/react-router';

import { ServicesRoutePage } from '../route-pages/content-route-pages';
import { publicPageRouteLoader } from '../storefront-page-data';

export const Route = createFileRoute('/services')({
    loader: publicPageRouteLoader,
    component: ServicesRoutePage,
});
