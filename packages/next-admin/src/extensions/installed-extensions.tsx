/* oxlint-disable react/only-export-components -- this module intentionally registers lazy extension components as import side effects */
import { KeyRound, Puzzle, Sparkles, Terminal, Truck, WalletCards } from 'lucide-react';
import { lazy, type ComponentType } from 'react';
import { Navigate } from 'react-router-dom';

import { CatalogBulkChannelAction } from '../pages/Catalog/CatalogBulkChannelAction';
import { CatalogExportAction } from '../pages/Catalog/CatalogExportAction';
import {
    CatalogOperationsBlock,
    ProductPackagingBlock,
    ProductVariantCustomFieldsBlock,
    ProductVariantPricesBlock,
} from '../pages/Catalog/CatalogOperationsBlocks';
import { CatalogImportAction } from '../pages/Catalog/import/CatalogImportAction';
import {
    ReferralTodayExtensionWidget,
    StaleTranslationExtensionAlert,
} from '../pages/Dashboard/DashboardExtensionPanels';
import { StorefrontTrafficPanel } from '../pages/Dashboard/StorefrontTrafficPanel';
import { OrderOperationsBlock } from '../pages/Sales/OrderOperationsBlock';
import { routeModuleLoaders } from '../route-modules';

import { defineNextAdminExtension } from './extension-api';

export const STORE_CURRENCY_COMPATIBILITY_TARGET = '/settings/store-profile?tab=payment-shipping';

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
const TwoFactorCodesModule = lazy(() =>
    routeModuleLoaders.twoFactorCodes().then(module => ({ default: module.TwoFactorCodesModule })),
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
const BusinessServicesCopyModule = lazy(() =>
    routeModuleLoaders.businessServicesCopy().then(module => ({
        default: module.BusinessServicesCopyModule,
    })),
);
const StoreSettingsModule = lazy(() =>
    routeModuleLoaders.storeSettings().then(module => ({ default: module.StoreSettingsModule })),
);
const SuppliersModule = lazy(() =>
    routeModuleLoaders.suppliers().then(module => ({ default: module.SuppliersModule })),
);
const UsdtPaymentManagementModule = lazy(() =>
    routeModuleLoaders.usdtPayments().then(module => ({ default: module.UsdtPaymentManagementModule })),
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
            legacyPaths: ['/image-generation-settings'],
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
            legacyPaths: ['/image-generation-access'],
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
    alerts: [
        {
            id: 'stale-content-translations',
            component: StaleTranslationExtensionAlert,
            permissions: ['ReadSettings', 'ReadCatalog'],
            order: 10,
        },
    ],
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
    id: 'two-factor-dashboard-plugin',
    routes: [
        {
            id: 'two-factor-codes',
            path: '/plugins/two-factor-codes',
            legacyPaths: ['/two-factor-codes'],
            title: '2FA 动态码',
            component: TwoFactorCodesModule,
            navItem: {
                label: '2FA 动态码',
                sectionId: 'plugins',
                icon: KeyRound,
                order: 50,
            },
            preload: routeModuleLoaders.twoFactorCodes,
        },
    ],
});

defineNextAdminExtension({
    id: 'catalog-management-plugin',
    routes: [
        {
            id: 'catalog-suppliers',
            path: '/catalog/suppliers',
            legacyPaths: ['/catalog-suppliers'],
            title: '供货商管理',
            component: SuppliersModule,
            permissions: ['ReadCatalogSupplier'],
            navItem: {
                label: '供货商管理',
                sectionId: 'catalog',
                icon: Truck,
                order: 60,
            },
            preload: routeModuleLoaders.suppliers,
        },
    ],
    actions: [
        {
            id: 'catalog-safe-import',
            pageId: 'product-list',
            label: '批量导入',
            component: CatalogImportAction,
            permissions: ['CreateCatalogImport'],
            order: 10,
        },
        {
            id: 'catalog-standard-export',
            pageId: 'product-list',
            label: '导出报表',
            component: CatalogExportAction,
            permissions: ['ReadCatalogExport'],
            order: 20,
        },
        {
            id: 'catalog-bulk-channels',
            pageId: 'product-list',
            label: '批量店铺',
            component: CatalogBulkChannelAction,
            permissions: ['UpdateProduct'],
            order: 30,
        },
    ],
    pageBlocks: [
        {
            id: 'catalog-product-operations',
            pageId: 'product-detail',
            component: CatalogOperationsBlock,
            permissions: ['ReadCatalogOperations'],
            order: 10,
        },
        {
            id: 'product-packaging',
            pageId: 'product-detail',
            component: ProductPackagingBlock,
            permissions: ['ReadProduct'],
            order: 20,
        },
        {
            id: 'product-variant-multi-currency-prices',
            pageId: 'product-detail',
            component: ProductVariantPricesBlock,
            permissions: ['ReadProduct'],
            order: 15,
        },
        {
            id: 'product-variant-custom-fields',
            pageId: 'product-detail',
            component: ProductVariantCustomFieldsBlock,
            permissions: ['ReadProduct'],
            order: 17,
        },
    ],
});

defineNextAdminExtension({
    id: 'storefront-content-plugin',
    routes: [
        {
            id: 'storefront-decoration',
            path: '/storefront/decoration',
            legacyPaths: ['/storefront-carousel', '/storefront-navigation'],
            title: '商城装修',
            component: StorefrontModule,
            permissions: ['ReadSettings', 'ReadCatalog'],
            preload: routeModuleLoaders.storefront,
        },
        {
            id: 'storefront-content',
            path: '/storefront/content',
            legacyPaths: [
                { path: '/auth-visuals', target: '/storefront/content?tab=pages' },
                { path: '/storefront-content', target: '/storefront/content?tab=pages' },
                { path: '/storefront-site-content', target: '/storefront/content?tab=pages' },
                { path: '/storefront-promotion', target: '/storefront/content?tab=landing' },
            ],
            title: '内容与页面',
            component: StorefrontContentModule,
            permissions: ['ReadSettings', 'ReadCatalog'],
            preload: routeModuleLoaders.storefrontContent,
        },
        {
            id: 'storefront-client-plugins',
            path: '/plugins/client-plugins',
            legacyPaths: ['/storefront-client-plugins'],
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
            id: 'business-services-copy',
            path: '/storefront/business-services-copy',
            legacyPaths: ['/business-services-copy'],
            title: '商业服务页文案',
            component: BusinessServicesCopyModule,
            permissions: ['ReadStorefrontContent', 'ReadSettings'],
            navItem: {
                label: '商业服务页文案',
                sectionId: 'plugins',
                icon: Sparkles,
                order: 15,
            },
            preload: routeModuleLoaders.businessServicesCopy,
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
    pageBlocks: [
        {
            id: 'order-payment-coupons-sellers',
            pageId: 'order-detail',
            component: OrderOperationsBlock,
            permissions: ['ReadOrder'],
            order: 10,
        },
    ],
    routes: [
        {
            id: 'operations-after-sales',
            path: '/sales/after-sales',
            legacyPaths: ['/after-sales'],
            title: '售后与退款',
            component: AfterSalesModule,
            permissions: ['ReadOrder'],
            preload: routeModuleLoaders.afterSales,
        },
        {
            id: 'operations-card-pool',
            path: '/catalog/card-pool',
            legacyPaths: ['/auto-card'],
            title: '发卡记录与异常',
            component: CardPoolModule,
            permissions: ['ReadCatalog', 'ReadProduct'],
            preload: routeModuleLoaders.cardPool,
        },
        {
            id: 'operations-reviews',
            path: '/sales/reviews',
            legacyPaths: ['/review-moderation'],
            title: '买家评价管理',
            component: ReviewsModule,
            permissions: ['ReadOrder'],
            preload: routeModuleLoaders.reviews,
        },
        {
            id: 'operations-manual-digital-delivery',
            path: '/operations/manual-digital-delivery',
            legacyPaths: ['/manual-digital-delivery'],
            title: '手动数字发货',
            component: redirectTo('/catalog/card-pool?tab=deliveries'),
            permissions: ['ReadOrder', 'ReadCatalog'],
            commandPalette: false,
        },
    ],
});

defineNextAdminExtension({
    id: 'store-management-plugin',
    dashboardWidgets: [
        {
            id: 'storefront-traffic-widget',
            title: '网站访问统计',
            description: '真实访问记录；独立访客为估算，独立 IP 不等于人数',
            component: StorefrontTrafficPanel,
            permissions: ['ReadReferral'],
            order: 19,
        },
        {
            id: 'referral-today-widget',
            title: '今日客户与邀请数据',
            description: '北京时间口径；独立访客为估算，— 表示无新版采集记录',
            component: ReferralTodayExtensionWidget,
            permissions: ['ReadCustomer', 'ReadOrder'],
            order: 20,
        },
    ],
    routes: [
        {
            id: 'store-management-profile',
            path: '/settings/store-profile',
            legacyPaths: ['/my-store-profile', '/store-management'],
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
            id: 'usdt-payment-management',
            path: '/settings/usdt-payments',
            legacyPaths: ['/usdt-payment-management'],
            title: '支付与 USDT 收款管理',
            component: UsdtPaymentManagementModule,
            permissions: ['SuperAdmin'],
            navItem: {
                label: 'USDT 收款管理',
                sectionId: 'settings',
                icon: WalletCards,
                order: 30,
            },
            preload: routeModuleLoaders.usdtPayments,
        },
        {
            id: 'store-management-promotions',
            path: '/marketing/promotions',
            legacyPaths: [
                { path: '/store-coupons', target: '/marketing/promotions?tab=coupons' },
                { path: '/store-flash-sales', target: '/marketing/promotions?tab=flash-sales' },
                { path: '/store-promotion-campaigns', target: '/marketing/promotions?tab=coupons' },
            ],
            title: '优惠与促销',
            component: PromotionsModule,
            permissions: ['ReadPromotion'],
            preload: routeModuleLoaders.promotions,
        },
        {
            id: 'store-management-referrals',
            path: '/marketing/referrals',
            legacyPaths: ['/referral-rewards'],
            title: '分销与返利',
            component: ReferralsModule,
            permissions: ['ReadPromotion', 'ReadCustomer', 'ReadOrder'],
            preload: routeModuleLoaders.referrals,
        },
        {
            id: 'store-management-commerce-compatibility',
            path: '/settings/store-commerce',
            legacyPaths: [{ path: '/store-commerce-settings', target: '/settings/store-profile?tab=stores' }],
            title: '店铺交易模式',
            component: redirectTo('/settings/store-profile?tab=stores'),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
        {
            id: 'store-management-currency-compatibility',
            path: '/settings/store-currency',
            legacyPaths: [{ path: '/store-currency-settings', target: STORE_CURRENCY_COMPATIBILITY_TARGET }],
            title: '店铺币种设置',
            component: redirectTo(STORE_CURRENCY_COMPATIBILITY_TARGET),
            permissions: ['ReadSettings'],
            commandPalette: false,
        },
        {
            id: 'store-management-provisioning-compatibility',
            path: '/settings/store-provisioning',
            legacyPaths: [{ path: '/store-provisioning', target: '/settings/store-profile?tab=stores' }],
            title: '开通店铺',
            component: redirectTo('/settings/store-profile?tab=stores'),
            permissions: ['CreateChannel'],
            commandPalette: false,
        },
        {
            id: 'store-management-announcements-compatibility',
            path: '/marketing/system-announcements',
            legacyPaths: [{ path: '/system-announcements', target: '/storefront/content?tab=announcements' }],
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
            legacyPaths: [{ path: '/my-store-domains', target: '/settings/store-profile?tab=domains' }],
            title: '店铺域名',
            component: redirectTo('/settings/store-profile?tab=domains'),
            permissions: ['ReadChannel'],
            commandPalette: false,
        },
    ],
});
