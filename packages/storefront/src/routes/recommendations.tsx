import { createFileRoute } from '@tanstack/react-router';

import { RecommendationsRoutePage } from '../route-pages/content-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/recommendations')({
    loader: storefrontRouteCodeLoader,
    component: RecommendationsRoutePage,
});
