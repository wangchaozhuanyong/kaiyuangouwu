import { defineDashboardExtension } from '@vendure/dashboard';

import { restrictPlatformNavigation } from './merchant-navigation';
import { MerchantPasswordGate } from './merchant-password-gate';
import { myStoreProfileRoute } from './my-store-profile-page';
import { referralRoute } from './referral-page';
import { ReferralTodayWidget } from './referral-today-widget';
import { storeCommerceSettingsRoute } from './store-commerce-settings-page';
import { StoreCouponOrderBlock } from './store-coupon-order-block';
import { storeCurrencySettingsRoute } from './store-currency-settings-page';
import { storeManagementRoute } from './store-management-page';
import {
    storeCouponCampaignRoute,
    storeFlashSaleRoute,
    storePromotionCampaignRoute,
} from './store-promotion-campaign-page';
import { storeProvisioningRoute } from './store-provisioning-page';
import { storefrontPromotionRoute } from './storefront-promotion-page';
import { systemAnnouncementRoute } from './system-announcement-page';
import { usdtPaymentManagementRoute } from './usdt-payment-management-page';

defineDashboardExtension({
    routes: [
        myStoreProfileRoute,
        storeCommerceSettingsRoute,
        storeCurrencySettingsRoute,
        storeManagementRoute,
        storeProvisioningRoute,
        storefrontPromotionRoute,
        storeCouponCampaignRoute,
        storeFlashSaleRoute,
        storePromotionCampaignRoute,
        systemAnnouncementRoute,
        usdtPaymentManagementRoute,
        referralRoute,
    ],
    widgets: [
        {
            id: 'referral-today-widget',
            name: '今日客户与邀请数据',
            order: 70,
            component: ReferralTodayWidget,
            defaultSize: { w: 12, h: 3, x: 0, y: 0 },
            minSize: { w: 8, h: 3 },
            requiresPermissions: ['ReadReferral'],
        },
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
