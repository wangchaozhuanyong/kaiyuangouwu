import { defineDashboardExtension } from '@vendure/dashboard';

import { authVisualRoute } from './auth-visual-page';
import {
    storefrontCarouselRoute,
    storefrontContentRoute,
    storefrontSiteContentRoute,
} from './storefront-content-page';

defineDashboardExtension({
    routes: [authVisualRoute, storefrontCarouselRoute, storefrontContentRoute, storefrontSiteContentRoute],
});
