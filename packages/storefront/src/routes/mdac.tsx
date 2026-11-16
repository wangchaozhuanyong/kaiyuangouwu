import { createFileRoute } from '@tanstack/react-router';

import { MdacRoutePage } from '../route-pages/mdac-route-page';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/mdac')({
    loader: storefrontRouteCodeLoader,
    component: MdacRoutePage,
});
