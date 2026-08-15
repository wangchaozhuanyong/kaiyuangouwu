import { defineDashboardExtension } from '@vendure/dashboard';

import { storefrontContentRoute } from './storefront-content-page';

defineDashboardExtension({
    routes: [storefrontContentRoute],
});
