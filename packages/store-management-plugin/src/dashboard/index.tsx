import { defineDashboardExtension } from '@vendure/dashboard';

import { restrictPlatformNavigation } from './merchant-navigation';
import { MerchantPasswordGate } from './merchant-password-gate';
import { myStoreProfileRoute } from './my-store-profile-page';
import { storeCommerceSettingsRoute } from './store-commerce-settings-page';
import { StoreCouponOrderBlock } from './store-coupon-order-block';
import { storeManagementRoute } from './store-management-page';
import {
    storeCouponCampaignRoute,
    storeFlashSaleRoute,
    storePromotionCampaignRoute,
} from './store-promotion-campaign-page';
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
        storeCouponCampaignRoute,
        storeFlashSaleRoute,
        storePromotionCampaignRoute,
        systemAnnouncementRoute,
    ],
    navSections: restrictPlatformNavigation,
    pageBlocks: [
        {
            id: 'store-coupon-order-allocations',
            title: '优惠券优惠明细',
            location: {
                pageId: 'order-detail',
                position: { blockId: 'order-table', order: 'after' },
                column: 'main',
            },
            component: StoreCouponOrderBlock,
        },
    ],
    customProviders: [
        {
            id: 'merchant-initial-password-gate',
            component: MerchantPasswordGate,
            location: 'app',
            order: -100,
        },
    ],
});
