import { createFileRoute } from '@tanstack/react-router';

import { GptRechargeRoutePage } from '../route-pages/gpt-recharge-route-page';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/gpt-recharge')({
    loader: storefrontRouteCodeLoader,
    component: GptRechargeRoutePage,
});
