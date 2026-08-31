/* oxlint-disable react/only-export-components -- this module intentionally registers lazy extension components as import side effects */
import { Puzzle, Sparkles, Terminal } from 'lucide-react';
import { lazy, type ComponentType } from 'react';
import { Navigate } from 'react-router-dom';
import { routeModuleLoaders } from '../route-modules';
import { defineNextAdminExtension } from './extension-api';

const AiImageSettingsModule = lazy(() =>
    routeModuleLoaders.aiImageSettings().then(module => ({
        default: module.AiImageSettingsModule,
    })),
);
const AiImageAccessModule = lazy(() =>
    routeModuleLoaders.aiImageAccess().then(module => ({ default: module.AiImageAccessModule })),
);
const TranslationsModule = lazy(() =>
    routeModuleLoaders.translations().then(module => ({ default: module.TranslationsModule })),
);
const ClientPluginsModule = lazy(() =>
    routeModuleLoaders.clientPlugins().then(module => ({ default: module.ClientPluginsModule })),
);
const CardPoolModule = lazy(() =>
    routeModuleLoaders.cardPool().then(module => ({ default: module.CardPoolModule })),
);
const AfterSalesModule = lazy(() =>
    routeModuleLoaders.afterSales().then(module => ({ default: module.AfterSalesModule })),
);
const ReviewsModule = lazy(() =>
    routeModuleLoaders.reviews().then(module => ({ default: module.ReviewsModule })),
);
const PromotionsModule = lazy(() =>
    routeModuleLoaders.promotions().then(module => ({ default: module.PromotionsModule })),
);
const ReferralsModule = lazy(() =>
    routeModuleLoaders.referrals().then(module => ({ default: module.ReferralsModule })),
);
const StorefrontModule = lazy(() =>
    routeModuleLoaders.storefront().then(module => ({ default: module.StorefrontModule })),
);
const StorefrontContentModule = lazy(() =>
    routeModuleLoaders.storefrontContent().then(module => ({
        default: module.StorefrontContentModule,
    })),
);
const StoreSettingsModule = lazy(() =>
    routeModuleLoaders.storeSettings().then(module => ({ default: module.StoreSettingsModule })),
);

function redirectTo(target: string): ComponentType {
    return function ExtensionRouteRedirect() {
        return <Navigate to={target} replace />;
    };
}

defineNextAdminExtension({
    id: 'image-generation-plugin',
    routes: [
        {
            id: 'image-generation-settings',
            path: '/plugins/ai-settings',
            title: 'AI 生图设置',
            component: AiImageSettingsModule,
            permissions: ['ReadSettings'],
            navItem: {
                label: 'AI 生图设置',
                sectionId: 'plugins',
                icon: Sparkles,
                order: 20,
            },
            preload: routeModuleLoaders.aiImageSettings,
        },
        {
            id: 'image-generation-access',
            path: '/plugins/ai-access',
            title: 'AI 服务商接入',
            component: AiImageAccessModule,
            permissions: ['SuperAdmin'],
            navItem: {
                label: 'AI 服务商接入',
                sectionId: 'plugins',
                icon: Terminal,
                order: 30,
            },
            preload: routeModuleLoaders.aiImageAccess,
        },
    ],
});

defineNextAdminExtension({
    id: 'content-translation-plugin',
    routes: [
        {
            id: 'content-translations',
            path: '/plugins/translations',
            title: '多语言内容翻译',
            component: TranslationsModule,
            permissions: ['ReadSettings', 'ReadCatalog'],
            navItem: {
                label: '多语言内容翻译',
                sectionId: 'plugins',
                icon: Sparkles,
                order: 40,
            },
            preload: routeModuleLoaders.translations,
        },
    ],
});

defineNextAdminExtension({
    id: 'storefront-content-plugin',
    routes: [
        {
            id: 'storefront-decoration',
            path: '/storefront/decoration',
            title: '商城装修',
            component: StorefrontModule,
            permissions: ['ReadSettings', 'ReadCatalog'],
            preload: routeModuleLoaders.storefront,
        },
        {
            id: 'storefront-content',
            path: '/storefront/content',
            title: '内容与页面',
            component: StorefrontContentModule,
            permissions: ['ReadSettings', 'ReadCatalog'],
            preload: routeModuleLoaders.storefrontContent,
        },
        {
            id: 'storefront-client-plugins',
            path: '/plugins/client-plugins',
            title: '客户端插件中心',
            component: ClientPluginsModule,
            permissions: ['ReadSettings'],
            navItem: {
                label: '客户端插件中心',
                sectionId: 'plugins',
                icon: Puzzle,
                order: 10,
            },
            preload: routeModuleLoaders.clientPlugins,
        },
        {
            id: 'storefront-auth-visuals-compatibility',
            path: '/storefront/auth-visuals',
            title: '登录与注册视觉',
            component: redirectTo('/storefront/content?tab=pages'),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
        {
            id: 'storefront-carousel-compatibility',
            path: '/storefront/carousel',
            title: '首页轮播图',
            component: redirectTo('/storefront/decoration'),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
        {
            id: 'storefront-navigation-compatibility',
            path: '/storefront/navigation',
            title: '商城导航',
            component: redirectTo('/storefront/decoration'),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
    ],
});

defineNextAdminExtension({
    id: 'operations-dashboard-plugin',
    routes: [
        {
            id: 'operations-after-sales',
            path: '/sales/after-sales',
            title: '售后与退款',
            component: AfterSalesModule,
            permissions: ['ReadOrder'],
            preload: routeModuleLoaders.afterSales,
        },
        {
            id: 'operations-card-pool',
            path: '/catalog/card-pool',
            title: '数字商品与卡密',
            component: CardPoolModule,
            permissions: ['ReadCatalog', 'ReadProduct'],
            preload: routeModuleLoaders.cardPool,
        },
        {
            id: 'operations-reviews',
            path: '/sales/reviews',
            title: '买家评价管理',
            component: ReviewsModule,
            permissions: ['ReadOrder'],
            preload: routeModuleLoaders.reviews,
        },
        {
            id: 'operations-manual-digital-delivery',
            path: '/operations/manual-digital-delivery',
            title: '手动数字发货',
            component: redirectTo('/catalog/card-pool?tab=deliveries'),
            permissions: ['ReadOrder', 'ReadCatalog'],
            commandPalette: false,
        },
    ],
});

defineNextAdminExtension({
    id: 'store-management-plugin',
    routes: [
        {
            id: 'store-management-profile',
            path: '/settings/store-profile',
            title: '店铺综合设置',
            component: StoreSettingsModule,
            permissions: [
                'ReadSettings',
                'ReadChannel',
                'ReadSeller',
                'ReadPaymentMethod',
                'ReadShippingMethod',
            ],
            preload: routeModuleLoaders.storeSettings,
        },
        {
            id: 'store-management-promotions',
            path: '/marketing/promotions',
            title: '优惠与促销',
            component: PromotionsModule,
            permissions: ['ReadPromotion'],
            preload: routeModuleLoaders.promotions,
        },
        {
            id: 'store-management-referrals',
            path: '/marketing/referrals',
            title: '分销与返利',
            component: ReferralsModule,
            permissions: ['ReadPromotion', 'ReadCustomer', 'ReadOrder'],
            preload: routeModuleLoaders.referrals,
        },
        {
            id: 'store-management-commerce-compatibility',
            path: '/settings/store-commerce',
            title: '店铺交易模式',
            component: redirectTo('/settings/store-profile?tab=business'),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
        {
            id: 'store-management-currency-compatibility',
            path: '/settings/store-currency',
            title: '店铺币种设置',
            component: redirectTo('/settings/store-profile?tab=business'),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
        {
            id: 'store-management-provisioning-compatibility',
            path: '/settings/store-provisioning',
            title: '开通店铺',
            component: redirectTo('/settings/store-profile?tab=stores'),
            permissions: ['CreateChannel'],
            commandPalette: false,
        },
        {
            id: 'store-management-announcements-compatibility',
            path: '/marketing/system-announcements',
            title: '系统公告',
            component: redirectTo('/storefront/content?tab=announcements'),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
    ],
});

defineNextAdminExtension({
    id: 'store-domain-plugin',
    routes: [
        {
            id: 'store-domains',
            path: '/settings/store-domains',
            title: '店铺域名',
            component: redirectTo('/settings/store-profile?tab=domains'),
            permissions: ['ReadChannel'],
            commandPalette: false,
        },
    ],
});
