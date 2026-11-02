import { createFileRoute } from '@tanstack/react-router';

import { BlogPage } from '../pages/blog-page';
import { publicPageRouteLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';
export const Route = createFileRoute('/blog/')({
    validateSearch: normalizeRouteSearch,
    loader: publicPageRouteLoader,
    component: BlogPage,
});
