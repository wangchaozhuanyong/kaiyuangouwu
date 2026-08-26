import { createFileRoute } from '@tanstack/react-router';

import { LegalRoutePage } from '../route-pages/legal-route-page';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/legal')({
    validateSearch: normalizeRouteSearch,
    component: LegalRoutePage,
});
