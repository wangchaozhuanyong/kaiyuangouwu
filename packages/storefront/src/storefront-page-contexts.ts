import { createContext, useContext } from 'react';
import type { AccountPageProps } from './pages/account-page';
import type { AnnouncementsPageProps } from './pages/announcements-page';
import type { BrowsingHistoryPageProps } from './pages/browsing-history-page';
import type { BusinessServicesPageProps } from './pages/business-services-page';
import type { CartPageProps } from './pages/cart-page';
import type { CategoryPageProps } from './pages/category-page';
import type { CouponCenterPageProps } from './pages/coupon-center-page';
import type { FavoriteProductsPageProps } from './pages/favorite-products-page';
import type { HomePageProps } from './pages/home-page';
import type { NotificationsPageProps } from './pages/notifications-page';
import type { ProductDetailPageProps } from './pages/product-detail-page';
import type { ReferralPageProps } from './pages/referral-page';
import type { SearchPageProps } from './pages/search-page';
import type { SupportPageProps } from './pages/support-page';

/** Page inputs have their own typed providers; they never replace application runtime state. */
function createPageContext<T>(name: string) {
    const context = createContext<T | null>(null);
    context.displayName = name;
    function useValue(): T {
        const value = useContext(context);
        if (value === null) throw new Error(`${name} requires its page provider`);
        return value;
    }
    return { Provider: context.Provider, useValue };
}

export const ReferralPageContext = createPageContext<ReferralPageProps>('ReferralPage');
export const SearchPageContext = createPageContext<SearchPageProps>('SearchPage');
export const HomePageContext = createPageContext<HomePageProps>('HomePage');
export const SupportPageContext = createPageContext<SupportPageProps>('SupportPage');
export const CouponCenterPageContext = createPageContext<CouponCenterPageProps>('CouponCenterPage');
export const CategoryPageContext = createPageContext<CategoryPageProps>('CategoryPage');
export const NotificationsPageContext = createPageContext<NotificationsPageProps>('NotificationsPage');
export const CartPageContext = createPageContext<CartPageProps>('CartPage');
export const ProductDetailPageContext = createPageContext<ProductDetailPageProps>('ProductDetailPage');
export const BusinessServicesPageContext =
    createPageContext<BusinessServicesPageProps>('BusinessServicesPage');
export const AccountPageContext = createPageContext<AccountPageProps>('AccountPage');
export const FavoriteProductsPageContext =
    createPageContext<FavoriteProductsPageProps>('FavoriteProductsPage');
export const BrowsingHistoryPageContext = createPageContext<BrowsingHistoryPageProps>('BrowsingHistoryPage');
export const AnnouncementsPageContext = createPageContext<AnnouncementsPageProps>('AnnouncementsPage');
