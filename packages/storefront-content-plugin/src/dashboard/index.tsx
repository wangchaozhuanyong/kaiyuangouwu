import { defineDashboardExtension } from '@vendure/dashboard';

import { authVisualRoute } from './auth-visual-page';
import { businessServicesCopyRoute } from './business-services-copy-page';
import { storefrontClientPluginRoute } from './storefront-client-plugin-page';
import {
    storefrontCarouselRoute,
    storefrontContentRoute,
    storefrontSiteContentRoute,
} from './storefront-content-page';
import { storefrontNavigationRoute } from './storefront-navigation-page';

defineDashboardExtension({
    routes: [
        authVisualRoute,
        businessServicesCopyRoute,
        storefrontCarouselRoute,
        storefrontContentRoute,
        storefrontSiteContentRoute,
        storefrontNavigationRoute,
        storefrontClientPluginRoute,
    ],
});
