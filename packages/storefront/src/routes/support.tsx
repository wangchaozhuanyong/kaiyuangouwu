import { createFileRoute } from '@tanstack/react-router';

import { SupportRoutePage } from '../route-pages/content-route-pages';
import { publicPageRouteLoader } from '../storefront-page-data';

export const Route = createFileRoute('/support')({
    loader: publicPageRouteLoader,
    component: SupportRoutePage,
});
