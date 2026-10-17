import { createFileRoute } from '@tanstack/react-router';

import { ReferralRoutePage } from '../route-pages/account-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/referral')({
    loader: storefrontRouteCodeLoader,
    component: ReferralRoutePage,
});
