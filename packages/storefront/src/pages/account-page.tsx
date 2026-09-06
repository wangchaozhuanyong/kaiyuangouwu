/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    Bell,
    ChevronRight,
    CircleCheck,
    ClipboardList,
    Gift,
    Headphones,
    Heart,
    MapPin,
    Megaphone,
    Package,
    RotateCcw,
    Settings,
    Store,
    TicketPercent,
    Truck,
    UserRound,
    WalletCards,
} from 'lucide-react';
import type { CSSProperties } from 'react';
// eslint-disable-next-line import/order -- organize-imports keeps relative type imports after packages.
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import { compactUiCopy, languageCodeFor } from '../i18n';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import { isReferralClientFeatureEnabled } from '../referral-client-feature';
import { ACCOUNT_RECOMMENDATION_CREST_IMAGE } from '../storefront-images';
import { AccountPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { orderStateLabel } from '../storefront-ui/order-ui';
import { AccountShortcut, LegalFooter, SectionHeader, ServiceButton } from '../storefront-ui/page-shell';
import { formatMoney, OrderImage, ProductVariantImage } from '../storefront-ui/product-display';
import { ProductSection } from '../storefront-ui/product-section';
import {
    ActiveCustomer,
    MarketConfig,
    Product,
    StorefrontContentTargetType,
    StorefrontLanguage,
} from '../types';

// TODO: Fix internal imports later

export interface AccountPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl: string | null;
    favoriteProductCount: number;
    announcementCount: number;
    couponCount: number;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    onLogout: () => void;
}

const accountSectionClass = 'account-section lg:m-0 lg:w-full';
const compactSectionHeaderClass =
    '[&_.section-header]:mb-1 [&_.section-header]:min-h-0 [&_.section-header]:items-center [&_.section-header-title-row_h2]:m-0 [&_.section-header-title-row_h2]:text-[15px] [&_.section-header-title-row_h2]:font-extrabold [&_.section-header-title-row_h2]:leading-[1.2] [&_.section-header-action-btn]:min-h-0 [&_.section-header-action-btn]:p-0 [&_.section-header-action-btn]:text-[12.5px] [&_.section-header-action-btn]:leading-[1.2] [&_.section-header-action-btn]:text-slate-500 hover:[&_.section-header-action-btn]:text-[var(--accent)] [&_.section-header-action-btn_svg]:size-3.5';

export function AccountPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const {
        api,
        customer,
        products,
        market,
        locale,
        language,
        storefrontName,
        logoUrl,
        favoriteProductCount,
        announcementCount,
        couponCount,
        onContentTarget,
        onLogout,
    } = AccountPageContext.useValue();
    const isZh = language === 'zh';
    const compactCopy = compactUiCopy[language];
    const orders = customer?.orders.items ?? [];
    const countsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerOrderCounts(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.customerOrderCounts(signal),
        enabled: !!customer,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const referralProgramQuery = useQuery({
        queryKey: storefrontQueryKeys.referralProgram(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
        ),
        queryFn: ({ signal }) => api.referralProgram(signal),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const referralEnabled = isReferralClientFeatureEnabled(referralProgramQuery.data);
    const referralOverviewQuery = useQuery({
        queryKey: storefrontQueryKeys.customerReferral(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.myReferralOverview(signal),
        enabled: Boolean(customer && referralEnabled),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const referralWallet = referralOverviewQuery.data?.wallets.find(
        wallet => wallet.currencyCode === market.currencyCode,
    );
    const counts = countsQuery.data ?? { pending: 0, shipping: 0, receiving: 0 };
    const afterSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.afterSalesRequests(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.afterSalesRequests(signal),
        enabled: Boolean(customer),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const activeAfterSalesCount = (afterSalesQuery.data ?? []).filter(request =>
        ['PENDING', 'APPROVED'].includes(request.state),
    ).length;
    const latestLogisticsOrder = orders.find(order =>
        order.lines.some(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        ),
    );
    const recentVariants = Array.from(
        new Map(
            orders.flatMap(order => order.lines).map(line => [line.productVariant.id, line.productVariant]),
        ).values(),
    ).slice(0, 2);
    const customerName = customer
        ? `${customer.lastName}${customer.firstName}`.trim() || customer.emailAddress
        : '';

    return (
        <main className="page account-page lg:grid lg:content-start lg:gap-4 lg:px-6 lg:pb-8 lg:pt-[88px]">
            <section
                className="account-hero lg:col-span-full"
                aria-labelledby={customer ? undefined : 'guest-account-title'}
            >
                {customer ? (
                    <div className="account-hero-content">
                        <button
                            className="account-hero-settings"
                            type="button"
                            title={isZh ? '账户与安全' : 'Account and security'}
                            aria-label={isZh ? '账户与安全' : 'Account and security'}
                            onClick={() => navigateTo({ name: 'account-security' })}
                        >
                            <Settings aria-hidden="true" />
                        </button>

                        <div className="account-hero-identity">
                            <div className="account-hero-avatar-wrap">
                                <button
                                    className="account-hero-avatar-button"
                                    type="button"
                                    onClick={() => navigateTo({ name: 'account-security' })}
                                    aria-label={isZh ? '个人信息与安全' : 'Profile and security'}
                                >
                                    <span className="account-hero-avatar">
                                        {customer.avatar?.preview ? (
                                            <img
                                                className="size-full rounded-full object-cover"
                                                src={customer.avatar.preview}
                                                alt=""
                                            />
                                        ) : (
                                            customerName.slice(0, 1).toUpperCase()
                                        )}
                                    </span>
                                </button>
                            </div>

                            <div className="account-hero-details">
                                <h1 className="account-hero-name">
                                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                                        {customerName}
                                    </span>
                                </h1>
                                <button
                                    className="account-hero-profile"
                                    type="button"
                                    onClick={() => navigateTo({ name: 'account-security' })}
                                >
                                    {isZh ? '查看个人资料' : 'View profile'}
                                    <ChevronRight aria-hidden="true" />
                                </button>
                            </div>
                        </div>

                        <div
                            className={`account-hero-assets grid ${referralEnabled ? 'grid-cols-4' : 'grid-cols-3'}`}
                            role="group"
                            aria-label={isZh ? '账户快捷入口' : 'Account shortcuts'}
                        >
                            <button
                                type="button"
                                className="account-hero-asset"
                                onClick={() => navigateTo({ name: 'favorites' })}
                            >
                                <span className="account-hero-asset-icon">
                                    <Heart aria-hidden="true" />
                                </span>
                                <span className="sr-only">{favoriteProductCount} </span>
                                <span className="account-hero-asset-label">
                                    {isZh ? '我的收藏' : 'Favorites'}
                                </span>
                            </button>

                            <button
                                type="button"
                                className="account-hero-asset"
                                onClick={() => navigateTo({ name: 'coupons' })}
                            >
                                <span className="account-hero-asset-icon">
                                    <TicketPercent aria-hidden="true" />
                                    {couponCount > 0 && <span className="account-hero-unread" />}
                                </span>
                                <span className="sr-only">{couponCount} </span>
                                <span className="account-hero-asset-label">
                                    {isZh ? '优惠券' : 'Coupons'}
                                </span>
                            </button>

                            <button
                                type="button"
                                className="account-hero-asset"
                                onClick={() => navigateTo({ name: 'announcements' })}
                            >
                                <span className="account-hero-asset-icon">
                                    <Megaphone aria-hidden="true" />
                                </span>
                                <span className="sr-only">{announcementCount} </span>
                                <span className="account-hero-asset-label">
                                    {isZh ? '网站公告' : 'Notices'}
                                </span>
                            </button>

                            {referralEnabled && (
                                <button
                                    type="button"
                                    className="account-hero-asset"
                                    onClick={() => navigateTo({ name: 'referral' })}
                                >
                                    <span className="account-hero-asset-icon">
                                        <Gift aria-hidden="true" />
                                    </span>
                                    <span className="sr-only">
                                        {referralOverviewQuery.isLoading
                                            ? '…'
                                            : formatMoney(
                                                  referralWallet?.availableBalance ?? 0,
                                                  market.currencyCode,
                                                  locale,
                                              )}
                                    </span>
                                    <span className="account-hero-asset-label">
                                        {isZh ? '邀请返利' : 'Referral'}
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="account-hero-content account-hero-guest">
                        <div className="account-hero-identity">
                            <div className="account-hero-avatar-wrap">
                                <span className="account-hero-avatar">
                                    <UserRound aria-hidden="true" />
                                </span>
                            </div>
                            <div className="account-hero-details">
                                <h1 id="guest-account-title" className="account-hero-name">
                                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                                        {isZh ? `欢迎来到 ${storefrontName}` : `Welcome to ${storefrontName}`}
                                    </span>
                                </h1>
                                <div className="account-hero-meta">
                                    <span>
                                        {isZh
                                            ? '登录后享受会员特权与专属优惠'
                                            : 'Sign in for member benefits and offers'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="account-hero-guest-actions">
                            <button
                                type="button"
                                className="account-hero-signin"
                                onClick={() => navigateTo({ name: 'login' })}
                            >
                                {isZh ? '立即登录' : 'Sign in'}
                            </button>
                            <button
                                type="button"
                                className="account-hero-register"
                                onClick={() => navigateTo({ name: 'register' })}
                            >
                                {isZh ? '免费注册' : 'Register'}
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section
                className={`${accountSectionClass} ${compactSectionHeaderClass} [&_nav]:mt-1 [&_nav]:grid [&_nav]:grid-cols-5 [&_nav]:gap-0.5 [&_nav>button]:flex [&_nav>button]:min-h-[52px] [&_nav>button]:min-w-0 [&_nav>button]:flex-col [&_nav>button]:items-center [&_nav>button]:justify-center [&_nav>button]:gap-1 [&_nav>button]:rounded-lg [&_nav>button]:border-0 [&_nav>button]:bg-transparent [&_nav>button]:px-0.5 [&_nav>button]:py-1 hover:[&_nav>button]:bg-[var(--soft)] [&_nav>button>span]:relative [&_nav>button>span]:grid [&_nav>button>span]:size-[26px] [&_nav>button>span]:place-items-center [&_nav>button>span]:text-slate-800 [&_nav>button>span_svg]:size-5 [&_nav>button>span_svg]:stroke-[1.8] [&_nav>button>span_b]:absolute [&_nav>button>span_b]:-right-2 [&_nav>button>span_b]:-top-1 [&_nav>button>span_b]:grid [&_nav>button>span_b]:h-4 [&_nav>button>span_b]:min-w-4 [&_nav>button>span_b]:place-items-center [&_nav>button>span_b]:rounded-full [&_nav>button>span_b]:border-2 [&_nav>button>span_b]:border-white [&_nav>button>span_b]:bg-[var(--danger)] [&_nav>button>span_b]:px-1 [&_nav>button>span_b]:text-[10px] [&_nav>button>span_b]:font-semibold [&_nav>button>span_b]:leading-3 [&_nav>button>span_b]:text-white [&_nav>button_small]:max-w-full [&_nav>button_small]:whitespace-nowrap [&_nav>button_small]:text-[10.5px] [&_nav>button_small]:font-medium [&_nav>button_small]:tracking-[-0.01em] [&_nav>button_small]:text-[var(--text)] min-[371px]:[&_nav>button_small]:text-xs [&_nav>button:nth-child(1)>span_svg]:text-amber-500 [&_nav>button:nth-child(2)>span_svg]:text-sky-600 [&_nav>button:nth-child(3)>span_svg]:text-indigo-600 [&_nav>button:nth-child(4)>span_svg]:text-rose-600 [&_nav>button:nth-child(5)>span_svg]:text-teal-600`}
            >
                <SectionHeader
                    title={compactCopy.orders.title}
                    action={compactCopy.orders.viewAll}
                    onAction={() => navigateTo({ name: 'orders', tab: 'all' })}
                />
                <nav className="account-order-shortcuts">
                    <AccountShortcut
                        icon={<WalletCards />}
                        label={compactCopy.orders.unpaid}
                        count={counts.pending}
                        onClick={() => navigateTo({ name: 'orders', tab: 'pending' })}
                    />
                    <AccountShortcut
                        icon={<Package />}
                        label={compactCopy.orders.processing}
                        count={counts.shipping}
                        onClick={() => navigateTo({ name: 'orders', tab: 'shipping' })}
                    />
                    <AccountShortcut
                        icon={<Truck />}
                        label={compactCopy.orders.shipped}
                        count={counts.receiving}
                        onClick={() => navigateTo({ name: 'orders', tab: 'receiving' })}
                    />
                    <AccountShortcut
                        icon={<RotateCcw />}
                        label={compactCopy.orders.returns}
                        count={activeAfterSalesCount}
                        onClick={() => navigateTo({ name: 'orders', tab: 'service' })}
                    />
                    <AccountShortcut
                        icon={<ClipboardList />}
                        label={compactCopy.orders.all}
                        count={0}
                        onClick={() => navigateTo({ name: 'orders', tab: 'all' })}
                    />
                </nav>
            </section>

            {customer && (
                <section
                    className={`${accountSectionClass} [&>header]:mb-1 [&>header]:flex [&>header]:min-h-[26px] [&>header]:items-center [&>header]:justify-between [&>header>span]:flex [&>header>span]:items-center [&>header>span]:gap-1.5 [&>header>span]:text-[13.5px] [&>header_strong]:font-bold [&>header_strong]:text-[var(--text)] [&>button]:grid [&>button]:min-h-[52px] [&>button]:w-full [&>button]:grid-cols-[40px_minmax(0,1fr)_14px] [&>button]:items-center [&>button]:gap-2.5 [&>button]:rounded-[10px] [&>button]:border [&>button]:border-[var(--line)] [&>button]:bg-[var(--soft)] [&>button]:px-2.5 [&>button]:py-1.5 [&>button]:text-left hover:[&>button]:border-[var(--accent)] [&>button>img]:size-10 [&>button>.responsive-picture>img]:size-10 [&>button>.image-placeholder]:size-10 [&>button>img]:rounded-md [&>button>.responsive-picture>img]:rounded-md [&>button>.image-placeholder]:rounded-md [&>button>span_strong]:text-[12.5px] [&>button>span_strong]:font-semibold [&>button>span_strong]:text-emerald-500 [&>button>span_small]:mt-0.5 [&>button>span_small]:block [&>button>span_small]:text-[11.5px] [&>button>span_small]:text-[var(--muted)]`}
                >
                    <header>
                        <h2>{isZh ? '最新物流' : 'Latest delivery'}</h2>
                        <button
                            className="inline-flex min-h-[26px] items-center gap-0.5 border-0 bg-transparent py-0 pl-2 pr-0 text-[12.5px] text-[var(--muted)] hover:text-[var(--accent)]"
                            type="button"
                            onClick={() => navigateTo({ name: 'logistics' })}
                        >
                            {isZh ? '更多' : 'More'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    </header>
                    {latestLogisticsOrder ? (
                        <button
                            type="button"
                            onClick={() => navigateTo({ name: 'order-detail', id: latestLogisticsOrder.id })}
                        >
                            <OrderImage order={latestLogisticsOrder} />
                            <span>
                                <strong>{orderStateLabel(latestLogisticsOrder.state, language)}</strong>
                                <small>
                                    {isZh
                                        ? `订单号 ${latestLogisticsOrder.code}`
                                        : `Order ${latestLogisticsOrder.code}`}
                                </small>
                            </span>
                            <ChevronRight />
                        </button>
                    ) : (
                        <div className="account-logistics-empty">
                            <Truck aria-hidden="true" />
                            <span>
                                <strong>{isZh ? '暂无物流动态' : 'No delivery updates'}</strong>
                                <small>
                                    {isZh
                                        ? '实物商品发货后会显示在这里'
                                        : 'Physical orders will appear here after purchase'}
                                </small>
                            </span>
                        </div>
                    )}
                </section>
            )}

            <section className={accountSectionClass} aria-label={isZh ? '常用服务' : 'Services'}>
                <h2 className="account-services-title">{isZh ? '常用服务' : 'Services'}</h2>
                <div className="account-service-grid grid grid-cols-4 gap-x-1 gap-y-1.5 lg:gap-4 [&>button]:flex [&>button]:min-h-14 [&>button]:min-w-0 [&>button]:flex-col [&>button]:items-center [&>button]:justify-center [&>button]:gap-1 [&>button]:rounded-lg [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-0.5 [&>button]:py-1 hover:[&>button]:bg-[var(--soft)] [&>button>span]:relative [&>button>span]:grid [&>button>span]:size-[34px] [&>button>span]:place-items-center [&>button>span]:rounded-[10px] [&>button>span]:bg-[var(--soft)] [&>button>span]:text-[var(--text)] [&>button>span]:transition-all hover:[&>button>span]:-translate-y-0.5 hover:[&>button>span]:shadow-[0_4px_10px_rgba(0,0,0,0.08)] [&>button>span_svg]:size-5 [&>button:nth-child(1)>span]:bg-rose-50 [&>button:nth-child(1)>span]:text-rose-500 [&>button:nth-child(2)>span]:bg-red-50 [&>button:nth-child(2)>span]:text-red-500 [&>button:nth-child(3)>span]:bg-amber-50 [&>button:nth-child(3)>span]:text-amber-500 [&>button:nth-child(4)>span]:bg-emerald-50 [&>button:nth-child(4)>span]:text-emerald-500 [&>button:nth-child(5)>span]:bg-sky-50 [&>button:nth-child(5)>span]:text-sky-500 [&>button:nth-child(6)>span]:bg-indigo-50 [&>button:nth-child(6)>span]:text-indigo-500 [&>button:nth-child(7)>span]:bg-violet-50 [&>button:nth-child(7)>span]:text-violet-500 [&>button:nth-child(8)>span]:bg-slate-100 [&>button:nth-child(8)>span]:text-slate-600 [&>button>span_em]:absolute [&>button>span_em]:-right-2 [&>button>span_em]:-top-[5px] [&>button>span_em]:grid [&>button>span_em]:h-4 [&>button>span_em]:min-w-5 [&>button>span_em]:place-items-center [&>button>span_em]:rounded-full [&>button>span_em]:border-[1.5px] [&>button>span_em]:border-white [&>button>span_em]:bg-[var(--accent)] [&>button>span_em]:px-1 [&>button>span_em]:text-[9px] [&>button>span_em]:font-semibold [&>button>span_em]:not-italic [&>button>span_em]:leading-[13px] [&>button>span_em]:text-white [&>button>b]:max-w-full [&>button>b]:overflow-hidden [&>button>b]:text-ellipsis [&>button>b]:whitespace-nowrap [&>button>b]:text-xs [&>button>b]:font-medium [&>button>b]:text-[var(--text)]">
                    <ServiceButton
                        icon={<Heart />}
                        label={compactCopy.services.favorites}
                        badge={favoriteProductCount > 0 ? String(favoriteProductCount) : undefined}
                        onClick={() => navigateTo({ name: 'favorites' })}
                    />
                    <ServiceButton
                        icon={<TicketPercent />}
                        label={compactCopy.services.coupons}
                        badge={couponCount > 0 ? String(couponCount) : undefined}
                        onClick={() => navigateTo({ name: 'coupons' })}
                    />
                    <ServiceButton
                        icon={<Megaphone />}
                        label={compactCopy.services.announcements}
                        badge={announcementCount > 0 ? String(announcementCount) : undefined}
                        onClick={() => navigateTo({ name: 'announcements' })}
                    />
                    <ServiceButton
                        icon={<MapPin />}
                        label={compactCopy.services.addresses}
                        onClick={() =>
                            customer ? navigateTo({ name: 'addresses' }) : navigateTo({ name: 'login' })
                        }
                    />
                    <ServiceButton
                        icon={<Bell />}
                        label={compactCopy.services.messages}
                        onClick={() => navigateTo({ name: 'notifications' })}
                    />
                    <ServiceButton
                        icon={<CircleCheck />}
                        label={compactCopy.services.reviews}
                        onClick={() => navigateTo({ name: 'reviews' })}
                    />
                    <ServiceButton
                        icon={<Headphones />}
                        label={compactCopy.services.support}
                        onClick={() => navigateTo({ name: 'support' })}
                    />
                    <ServiceButton
                        icon={<Store />}
                        label={compactCopy.services.store}
                        onClick={() => navigateTo({ name: 'home' })}
                    />
                </div>
            </section>

            {!!recentVariants.length && (
                <section
                    className={`${accountSectionClass} ${compactSectionHeaderClass} pt-0 lg:pt-0 [&>.section-header]:mb-0 [&>.section-header]:min-h-11 lg:[&>.section-header]:min-h-[52px] [&>div>article]:grid [&>div>article]:min-h-[68px] [&>div>article]:grid-cols-[54px_minmax(0,1fr)_auto] [&>div>article]:items-center [&>div>article]:gap-2.5 [&>div>article]:border-t [&>div>article]:border-[var(--line)] [&>div>article]:py-[7px] [&_article>img]:size-[54px] [&_article>.responsive-picture>img]:size-[54px] [&_article>.image-placeholder]:size-[54px] [&_article>img]:rounded-[7px] [&_article>.responsive-picture>img]:rounded-[7px] [&_article>.image-placeholder]:rounded-[7px] [&_article>img]:object-contain [&_article_strong]:block [&_article_strong]:overflow-hidden [&_article_strong]:text-ellipsis [&_article_strong]:whitespace-nowrap [&_article_small]:mt-1 [&_article_small]:block [&_article_small]:text-[var(--muted)] [&_article>button]:min-h-9 [&_article>button]:rounded-md [&_article>button]:border [&_article>button]:border-[var(--accent)] [&_article>button]:bg-white [&_article>button]:px-2.5 [&_article>button]:text-[var(--accent)]`}
                >
                    <SectionHeader
                        title={isZh ? '最近买过' : 'Recently purchased'}
                        action={isZh ? '查看订单' : 'View orders'}
                        onAction={() => navigateTo({ name: 'orders', tab: 'all' })}
                    />
                    <div>
                        {recentVariants.map(variant => (
                            <article key={variant.id}>
                                <ProductVariantImage variant={variant} alt={variant.name} />
                                <span>
                                    <strong>{variant.name}</strong>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => navigateTo({ name: 'product', id: variant.product.id })}
                                >
                                    {isZh ? '再次购买' : 'Buy again'}
                                </button>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            <ProductSection
                centerLabel={isZh ? '专属推荐' : 'Just for you'}
                className="lg:col-span-full [&_.section-header]:relative [&_.section-header]:grid [&_.section-header]:min-h-[70px] [&_.section-header]:grid-cols-1 [&_.section-header]:place-items-center [&_.section-header]:overflow-hidden [&_.section-header-center-label]:grid [&_.section-header-center-label]:min-h-[70px] [&_.section-header-center-label]:w-full [&_.section-header-center-label]:place-items-center [&_.section-header-center-label]:bg-[image:var(--account-recommendation-image)] [&_.section-header-center-label]:bg-[length:min(100%,330px)_auto] [&_.section-header-center-label]:bg-center [&_.section-header-center-label]:bg-no-repeat [&_.section-header-center-label]:text-[16px] [&_.section-header-center-label]:font-semibold [&_.section-header-center-label]:tracking-[0.16em] [&_.section-header-center-label]:text-[var(--accent-ink)] [&_.section-header-center-label]:[text-indent:0.16em]"
                style={
                    {
                        '--account-recommendation-image': `url(${JSON.stringify(ACCOUNT_RECOMMENDATION_CREST_IMAGE)})`,
                    } as CSSProperties
                }
                products={products.slice(0, 4)}
                market={market}
                locale={locale}
                language={language}
                onProduct={product => navigateTo({ name: 'product', id: product.id })}
            />
            <LegalFooter
                storefrontName={storefrontName}
                language={language}
                onContentTarget={onContentTarget}
            />
        </main>
    );
}
