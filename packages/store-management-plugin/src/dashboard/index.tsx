import { defineDashboardExtension } from '@vendure/dashboard';

import { MerchantPasswordGate } from './merchant-password-gate';
import { myStoreProfileRoute } from './my-store-profile-page';
import { storeManagementRoute } from './store-management-page';
import { storeProvisioningRoute } from './store-provisioning-page';

defineDashboardExtension({
    routes: [myStoreProfileRoute, storeManagementRoute, storeProvisioningRoute],
    customProviders: [
        {
            id: 'merchant-initial-password-gate',
            component: MerchantPasswordGate,
            location: 'layout',
            order: -100,
        },
    ],
});
