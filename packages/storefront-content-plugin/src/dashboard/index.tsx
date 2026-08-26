import { defineDashboardExtension } from '@vendure/dashboard';

import { storefrontCarouselRoute, storefrontContentRoute } from './storefront-content-page';

defineDashboardExtension({
    routes: [storefrontCarouselRoute, storefrontContentRoute],
});
