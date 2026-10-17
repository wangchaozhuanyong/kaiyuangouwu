import { createFileRoute } from '@tanstack/react-router';

import { FlashSaleRoutePage } from '../route-pages/content-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/flash-sale')({
    loader: storefrontRouteCodeLoader,
    component: FlashSaleRoutePage,
});
