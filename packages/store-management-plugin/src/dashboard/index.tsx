import { defineDashboardExtension } from '@vendure/dashboard';

import { restrictPlatformNavigation } from './merchant-navigation';
import { MerchantPasswordGate } from './merchant-password-gate';
import { myStoreProfileRoute } from './my-store-profile-page';
import { storeCommerceSettingsRoute } from './store-commerce-settings-page';
import { storeManagementRoute } from './store-management-page';
import { storePromotionCampaignRoute } from './store-promotion-campaign-page';
import { storeProvisioningRoute } from './store-provisioning-page';
import { storefrontPromotionRoute } from './storefront-promotion-page';
import { systemAnnouncementRoute } from './system-announcement-page';

defineDashboardExtension({
    routes: [
        myStoreProfileRoute,
        storeCommerceSettingsRoute,
        storeManagementRoute,
        storeProvisioningRoute,
        storefrontPromotionRoute,
        storePromotionCampaignRoute,
        systemAnnouncementRoute,
    ],
    navSections: restrictPlatformNavigation,
    customProviders: [
        {
            id: 'merchant-initial-password-gate',
            component: MerchantPasswordGate,
            location: 'app',
            order: -100,
        },
    ],
});
