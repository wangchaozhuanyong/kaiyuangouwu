import { defineDashboardExtension } from '@vendure/dashboard';

import { storeManagementRoute } from './store-management-page';
import { storeProvisioningRoute } from './store-provisioning-page';

defineDashboardExtension({
    routes: [storeManagementRoute, storeProvisioningRoute],
});
