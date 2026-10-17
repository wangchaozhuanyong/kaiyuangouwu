import { createFileRoute } from '@tanstack/react-router';

import { ReviewsRoutePage } from '../route-pages/content-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/reviews')({
    loader: storefrontRouteCodeLoader,
    component: ReviewsRoutePage,
});
