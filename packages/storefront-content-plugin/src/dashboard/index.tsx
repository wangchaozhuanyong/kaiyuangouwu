import { defineDashboardExtension } from '@vendure/dashboard';

import {
    storefrontCarouselRoute,
    storefrontContentRoute,
    storefrontSiteContentRoute,
} from './storefront-content-page';

defineDashboardExtension({
    routes: [storefrontCarouselRoute, storefrontContentRoute, storefrontSiteContentRoute],
});
