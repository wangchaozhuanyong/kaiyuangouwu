import { lazyRouteComponent } from '@tanstack/react-router';

import {
    AccountPageContext,
    AnnouncementsPageContext,
    BrowsingHistoryPageContext,
    CouponCenterPageContext,
    FavoriteProductsPageContext,
    NotificationsPageContext,
    ReferralPageContext,
} from '../storefront-page-contexts';

import { registerRoutePreload, RouteGate, useRouteRuntime as useRuntime } from './shared';

const AccountPage = lazyRouteComponent(() => import('../pages/account-page'), 'AccountPage');
const AnnouncementsPage = lazyRouteComponent(
    () => import('../pages/announcements-page'),
    'AnnouncementsPage',
);
const BrowsingHistoryPage = lazyRouteComponent(
    () => import('../pages/browsing-history-page'),
    'BrowsingHistoryPage',
);
const CouponCenterPage = lazyRouteComponent(() => import('../pages/coupon-center-page'), 'CouponCenterPage');
const FavoriteProductsPage = lazyRouteComponent(
    () => import('../pages/favorite-products-page'),
    'FavoriteProductsPage',
);
const NotificationsPage = lazyRouteComponent(
    () => import('../pages/notifications-page'),
    'NotificationsPage',
);
const ReferralPage = lazyRouteComponent(() => import('../pages/referral-page'), 'ReferralPage');

export function AccountRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="account">
            <AccountPageContext.Provider
                value={{
                    api: runtime.api,
                    customer: runtime.customer,
                    products: runtime.products,
                    market: runtime.market,
                    locale: runtime.locale,
                    language: runtime.language,
                    storefrontName: runtime.storefrontName,
                    logoUrl: runtime.logoUrl,
                    favoriteProductCount: runtime.favoriteProductIds.length,
                    announcementCount: runtime.systemAnnouncements.length,
                    couponCount: runtime.myCoupons.filter((coupon: { status: string }) =>
                        ['AVAILABLE', 'RETURNED', 'LOCKED'].includes(coupon.status),
                    ).length,
                    onContentTarget: runtime.openContentTarget,
                    onLogout: () => {
                        void runtime.api.logout().then(() => {
                            runtime.clearPrivateQueryCache();
                            runtime.setCustomer(null);
                            runtime.notify(runtime.language === 'zh' ? '已退出登录' : 'Signed out');
                        });
                    },
                }}
            >
                <AccountPage />
            </AccountPageContext.Provider>
        </RouteGate>
    );
}

export function AnnouncementsRoutePage() {
    const runtime = useRuntime();
    return (
        <AnnouncementsPageContext.Provider
            value={{
                announcements: runtime.systemAnnouncements,
                loading: runtime.contentQuery.isLoading && runtime.contentQuery.data === undefined,
                error: runtime.contentError,
                language: runtime.language,
                onBack: runtime.goBack,
                onRetry: () => void runtime.contentQuery.refetch(),
            }}
        >
            <AnnouncementsPage />
        </AnnouncementsPageContext.Provider>
    );
}

export function FavoritesRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    return (
        <FavoriteProductsPageContext.Provider
            value={{
                api: runtime.api,
                productIds: runtime.favoriteProductIds,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                onRemove: (productId: string) => {
                    runtime.toggleFavoriteProduct(productId);
                    runtime.notify(isZh ? '已取消收藏' : 'Removed from favorites');
                },
                onClear: () => {
                    if (runtime.storefrontCode) {
                        localStorage.removeItem(`storefront-favorite-product-ids:${runtime.storefrontCode}`);
                    }
                    runtime.setFavoriteProductIds([]);
                    runtime.notify(isZh ? '收藏已清空' : 'Favorites cleared');
                },
            }}
        >
            <FavoriteProductsPage />
        </FavoriteProductsPageContext.Provider>
    );
}

export function HistoryRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    return (
        <BrowsingHistoryPageContext.Provider
            value={{
                api: runtime.api,
                productIds: runtime.recentProductIds,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                onClear: () => {
                    if (runtime.storefrontCode) {
                        localStorage.removeItem(`storefront-recent-product-ids:${runtime.storefrontCode}`);
                    }
                    runtime.setRecentProductIds([]);
                    runtime.notify(isZh ? '浏览足迹已清空' : 'Browsing history cleared');
                },
            }}
        >
            <BrowsingHistoryPage />
        </BrowsingHistoryPageContext.Provider>
    );
}

export function NotificationsRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="notifications">
            <NotificationsPageContext.Provider
                value={{
                    api: runtime.api,
                    customer: runtime.customer,
                    market: runtime.market,
                    locale: runtime.locale,
                    language: runtime.language,
                }}
            >
                <NotificationsPage />
            </NotificationsPageContext.Provider>
        </RouteGate>
    );
}

export function CouponsRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="coupons">
            <CouponCenterPageContext.Provider
                value={{
                    coupons: runtime.activeCoupons,
                    myCoupons: runtime.myCoupons,
                    usageRecords: runtime.couponUsageRecords,
                    currencyCode: runtime.market.currencyCode,
                    displayCurrencyCode: runtime.displayCurrencyCode,
                    language: runtime.language,
                    loading: runtime.cartLoading,
                    campaignsLoading: runtime.couponCampaignsLoading,
                    campaignsError: runtime.couponCampaignsError,
                    myCouponsLoading:
                        runtime.customerCouponsQuery.isPending &&
                        runtime.customerCouponsQuery.data === undefined,
                    myCouponsError: runtime.customerCouponsError,
                    usageRecordsLoading:
                        runtime.customerCouponUsageRecordsQuery.isPending &&
                        runtime.customerCouponUsageRecordsQuery.data === undefined,
                    usageRecordsError: runtime.customerCouponUsageRecordsError,
                    onRetryCampaigns: () => void runtime.couponCampaignsQuery.refetch(),
                    onRetryMyCoupons: () => void runtime.customerCouponsQuery.refetch(),
                    onRetryUsageRecords: () => void runtime.customerCouponUsageRecordsQuery.refetch(),
                    onClaim: runtime.claimCoupon,
                }}
            >
                <CouponCenterPage />
            </CouponCenterPageContext.Provider>
        </RouteGate>
    );
}

export function ReferralRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="referral">
            <ReferralPageContext.Provider
                value={{
                    api: runtime.api,
                    customer: runtime.customer,
                    market: runtime.market,
                    locale: runtime.locale,
                    language: runtime.language,
                    storefrontName: runtime.storefrontName,
                    logoUrl: runtime.logoUrl,
                    onBack: runtime.goBack,
                    onNotify: runtime.notify,
                    onLogin: () => runtime.navigate({ name: 'login' }),
                }}
            >
                <ReferralPage />
            </ReferralPageContext.Provider>
        </RouteGate>
    );
}

export const preloadAccountRoutePage = registerRoutePreload(AccountRoutePage, AccountPage);
export const preloadAnnouncementsRoutePage = registerRoutePreload(AnnouncementsRoutePage, AnnouncementsPage);
export const preloadFavoritesRoutePage = registerRoutePreload(FavoritesRoutePage, FavoriteProductsPage);
export const preloadHistoryRoutePage = registerRoutePreload(HistoryRoutePage, BrowsingHistoryPage);
export const preloadNotificationsRoutePage = registerRoutePreload(NotificationsRoutePage, NotificationsPage);
export const preloadCouponsRoutePage = registerRoutePreload(CouponsRoutePage, CouponCenterPage);
export const preloadReferralRoutePage = registerRoutePreload(ReferralRoutePage, ReferralPage);
