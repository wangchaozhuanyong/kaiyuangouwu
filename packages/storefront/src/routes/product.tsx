import { createFileRoute } from '@tanstack/react-router';

import { ProductRoutePage } from '../route-pages/catalog-detail-route-pages';
import { publicPageRouteLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/product')({
    validateSearch: normalizeRouteSearch,
    loaderDeps: ({ search }) => ({
        id: search.id,
        language: search.__storefrontLanguage,
    }),
    loader: publicPageRouteLoader,
    component: ProductRoutePage,
});
