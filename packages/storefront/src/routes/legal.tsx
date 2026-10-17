import { createFileRoute } from '@tanstack/react-router';

import { LegalRoutePage } from '../route-pages/legal-route-page';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/legal')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: LegalRoutePage,
});
