import { lazyRouteComponent } from '@tanstack/react-router';

import { ProductVariant } from '../types';

import {
    RoutePageContext as PageContext,
    registerRoutePreload,
    RouteGate,
    useRouteRuntime as useRuntime,
} from './shared';

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
            <PageContext
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
                    addingVariantId: runtime.addingVariantId,
                    onContentTarget: runtime.openContentTarget,
                    onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
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
            </PageContext>
        </RouteGate>
    );
}

export function AnnouncementsRoutePage() {
    const runtime = useRuntime();
    return (
        <PageContext
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
        </PageContext>
    );
}

export function FavoritesRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    return (
        <PageContext
            value={{
                api: runtime.api,
                productIds: runtime.favoriteProductIds,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                addingVariantId: runtime.addingVariantId,
                onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
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
        </PageContext>
    );
}

export function HistoryRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    return (
        <PageContext
            value={{
                api: runtime.api,
                productIds: runtime.recentProductIds,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                addingVariantId: runtime.addingVariantId,
                onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
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
        </PageContext>
    );
}

export function NotificationsRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="notifications">
            <PageContext
                value={{
                    api: runtime.api,
                    customer: runtime.customer,
                    market: runtime.market,
                    locale: runtime.locale,
                    language: runtime.language,
                }}
            >
                <NotificationsPage />
            </PageContext>
        </RouteGate>
    );
}

export function CouponsRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="coupons">
            <PageContext
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
            </PageContext>
        </RouteGate>
    );
}

export function ReferralRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="referral">
            <PageContext
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
            </PageContext>
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
