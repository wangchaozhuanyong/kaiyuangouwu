import { defineDashboardExtension } from '@vendure/dashboard';

import { authVisualRoute } from './auth-visual-page';
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
        storefrontCarouselRoute,
        storefrontContentRoute,
        storefrontSiteContentRoute,
        storefrontNavigationRoute,
        storefrontClientPluginRoute,
    ],
});
