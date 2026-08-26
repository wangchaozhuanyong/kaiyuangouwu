import { lazy } from 'react';

import { ProductVariant } from '../types';

import { RoutePageContext as PageContext, RouteGate, useRouteRuntime as useRuntime } from './shared';

const AccountPage = lazy(() =>
    import('../pages/account-page').then(module => ({ default: module.AccountPage })),
);
const BrowsingHistoryPage = lazy(() =>
    import('../pages/browsing-history-page').then(module => ({ default: module.BrowsingHistoryPage })),
);
const CouponCenterPage = lazy(() =>
    import('../pages/coupon-center-page').then(module => ({ default: module.CouponCenterPage })),
);
const FavoriteProductsPage = lazy(() =>
    import('../pages/favorite-products-page').then(module => ({ default: module.FavoriteProductsPage })),
);
const NotificationsPage = lazy(() =>
    import('../pages/notifications-page').then(module => ({ default: module.NotificationsPage })),
);
const ReferralPage = lazy(() =>
    import('../pages/referral-page').then(module => ({ default: module.ReferralPage })),
);

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
                    recentProductCount: runtime.recentProductIds.length,
                    couponCount: runtime.myCoupons.filter((coupon: { usable: boolean }) => coupon.usable)
                        .length,
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
                    currencyCode: runtime.market.currencyCode,
                    language: runtime.language,
                    loading: runtime.cartLoading,
                    cartHasItems: (runtime.cart?.totalQuantity ?? 0) > 0,
                    onClaim: runtime.claimCoupon,
                    onApply: runtime.applyCoupon,
                    onRemove: runtime.removeCoupon,
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
