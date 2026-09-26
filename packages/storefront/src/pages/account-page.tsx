/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    Bell,
    ChevronRight,
    CircleCheck,
    Headphones,
    Heart,
    MapPin,
    Package,
    RotateCcw,
    Store,
    TicketPercent,
    Truck,
    UserRound,
    WalletCards,
} from 'lucide-react';
// eslint-disable-next-line import/order -- organize-imports keeps relative type imports after packages.
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import accountRefractionImage from '../assets/ui/account-refraction.webp';
import { AccountOrderCarousel } from '../components/common/account-order-carousel';
import { MobilePageHeader } from '../components/common/mobile-page-header';
import { useDesktopLayout } from '../desktop-layout';
import { compactUiCopy, languageCodeFor } from '../i18n';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import {
    isReferralClientFeatureEnabled,
    readCachedReferralProgram,
    writeCachedReferralProgram,
} from '../referral-client-feature';
import { SafeImage } from '../safe-image';
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

import { DesktopAccountPage } from './desktop-account-page';

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
    accountHeroImageUrl: string | null;
    favoriteProductCount: number;
    couponCount: number;
    displayCurrencyCode?: string;
    availableCurrencyCodes?: string[];
    currencyLoading?: boolean;
    onToggleLanguage?: () => void;
    onCurrencyChange?: (currencyCode: string) => void | Promise<void>;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    onLogout: () => void;
}

const accountSectionClass = 'account-panel account-section';
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
        accountHeroImageUrl,
        favoriteProductCount,
        couponCount,
        displayCurrencyCode,
        availableCurrencyCodes,
        currencyLoading,
        onToggleLanguage,
        onCurrencyChange,
        onContentTarget,
        onLogout,
    } = AccountPageContext.useValue();
    const isZh = language === 'zh';
    const desktop = useDesktopLayout();
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
        queryFn: async ({ signal }) => {
            const program = await api.referralProgram(signal);
            if (program) {
                writeCachedReferralProgram(market.code, program);
            }
            return program;
        },
        initialData: () => readCachedReferralProgram(market.code),
        initialDataUpdatedAt: 0,
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
    const counts = countsQuery.data ?? { pending: 0, shipping: 0, receiving: 0, completed: 0 };
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
    const pagePending = Boolean(
        customer &&
        (countsQuery.isPending ||
            afterSalesQuery.isPending ||
            referralProgramQuery.isPending ||
            (referralEnabled && referralOverviewQuery.isPending)),
    );
    const latestLogisticsOrder = orders.find(order =>
        order.lines.some(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        ),
    );
    const latestOrder = orders[0];
    const recentVariants = Array.from(
        new Map(
            orders.flatMap(order => order.lines).map(line => [line.productVariant.id, line.productVariant]),
        ).values(),
    ).slice(0, 2);
    const customerName = customer
        ? `${customer.lastName}${customer.firstName}`.trim() || customer.emailAddress
        : '';

    if (desktop)
        return (
            <DesktopAccountPage
                pending={pagePending}
                customer={customer}
                products={products}
                market={market}
                locale={locale}
                language={language}
                storefrontName={storefrontName}
                favoriteProductCount={favoriteProductCount}
                couponCount={couponCount}
                onContentTarget={onContentTarget}
                counts={countsQuery.data}
                countsError={countsQuery.isError}
                onRetryCounts={() => void countsQuery.refetch()}
                afterSalesCount={afterSalesQuery.data ? activeAfterSalesCount : undefined}
                referralEnabled={referralEnabled}
                referralBalance={referralWallet?.availableBalance}
                navigate={navigateTo}
            />
        );

    return (
        <main
            className="page account-page lg:grid lg:content-start lg:gap-4 lg:pb-8 lg:pt-[88px]"
            data-page-pending={pagePending ? 'query' : undefined}
        >
            {!desktop && (
                <MobilePageHeader
                    className="account-mobile-header"
                    title={isZh ? '个人中心' : 'My account'}
                    storefrontName={storefrontName}
                    logoUrl={logoUrl}
                    language={language}
                    marketLabel={market.label}
                    displayCurrencyCode={displayCurrencyCode ?? market.currencyCode}
                    availableCurrencyCodes={availableCurrencyCodes ?? []}
                    currencyLoading={currencyLoading ?? false}
                    onToggleLanguage={onToggleLanguage}
                    onCurrencyChange={onCurrencyChange}
                    onNotifications={() => navigateTo({ name: 'notifications' })}
                />
            )}
            <section
                className={`account-hero lg:col-span-full ${accountHeroImageUrl ? 'has-custom-background' : ''}`}
                aria-labelledby={customer ? undefined : 'guest-account-title'}
            >
                {accountHeroImageUrl && (
                    <SafeImage
                        src={accountHeroImageUrl}
                        fallbackSrc={accountRefractionImage}
                        placeholderSrc={accountRefractionImage}
                        frameClassName="account-hero-art"
                        imageKind="hero"
                        sizes="100vw"
                        alt=""
                    />
                )}
                {customer ? (
                    <div className="account-hero-content">
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
                                            <SafeImage
                                                className="size-full rounded-full object-cover"
                                                src={customer.avatar.preview}
                                                alt=""
                                            />
                                        ) : desktop ? (
                                            <UserRound aria-hidden="true" />
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
                            className="account-hero-assets"
                            role="group"
                            aria-label={isZh ? '账户快捷入口' : 'Account shortcuts'}
                        >
                            {referralEnabled ? (
                                <button
                                    type="button"
                                    className="account-hero-asset"
                                    onClick={() => navigateTo({ name: 'referral' })}
                                >
                                    <strong className="account-hero-asset-value">
                                        {referralOverviewQuery.isLoading ||
                                        referralOverviewQuery.isError ||
                                        !referralWallet
                                            ? '—'
                                            : formatMoney(
                                                  referralWallet.availableBalance,
                                                  market.currencyCode,
                                                  locale,
                                              )}
                                    </strong>
                                    <span className="account-hero-asset-label">
                                        {isZh ? '返利余额' : 'Referral balance'}
                                    </span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="account-hero-asset"
                                    onClick={() => navigateTo({ name: 'favorites' })}
                                >
                                    <strong className="account-hero-asset-value">
                                        {favoriteProductCount}
                                    </strong>
                                    <span className="account-hero-asset-label">
                                        {isZh ? '我的收藏' : 'Favorites'}
                                    </span>
                                </button>
                            )}
                            <button
                                type="button"
                                className="account-hero-asset"
                                onClick={() => navigateTo({ name: 'coupons' })}
                            >
                                <strong className="account-hero-asset-value">{couponCount}</strong>
                                <span className="account-hero-asset-label">
                                    {isZh ? '有效优惠券' : 'Coupons'}
                                </span>
                            </button>
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

            <section className={`account-orders ${accountSectionClass}`}>
                <SectionHeader
                    title={isZh ? '我的订单中心' : 'My orders'}
                    action={isZh ? '全部订单' : 'View all'}
                    onAction={() => navigateTo({ name: 'orders', tab: 'all' })}
                />
                <AccountOrderCarousel isZh={isZh}>
                    <AccountShortcut
                        inlineCount={desktop}
                        icon={<WalletCards />}
                        tone="pending"
                        label={compactCopy.orders.unpaid}
                        count={desktop ? countsQuery.data?.pending : counts.pending}
                        onClick={() => navigateTo({ name: 'orders', tab: 'pending' })}
                    />
                    <AccountShortcut
                        inlineCount={desktop}
                        icon={<Package />}
                        tone="shipping"
                        label={compactCopy.orders.processing}
                        count={desktop ? countsQuery.data?.shipping : counts.shipping}
                        onClick={() => navigateTo({ name: 'orders', tab: 'shipping' })}
                    />
                    <AccountShortcut
                        inlineCount={desktop}
                        icon={<Truck />}
                        tone="receiving"
                        label={compactCopy.orders.shipped}
                        count={desktop ? countsQuery.data?.receiving : counts.receiving}
                        onClick={() => navigateTo({ name: 'orders', tab: 'receiving' })}
                    />
                    <AccountShortcut
                        inlineCount={desktop}
                        icon={<CircleCheck />}
                        tone="completed"
                        label={compactCopy.orders.completed}
                        count={desktop ? countsQuery.data?.completed : counts.completed}
                        onClick={() => navigateTo({ name: 'orders', tab: 'completed' })}
                    />
                    <AccountShortcut
                        inlineCount={desktop}
                        icon={<CircleCheck />}
                        tone="reviews"
                        label={isZh ? '评价' : 'Reviews'}
                        count={undefined}
                        onClick={() => navigateTo({ name: 'reviews' })}
                    />
                    <AccountShortcut
                        inlineCount={desktop}
                        icon={<RotateCcw />}
                        tone="service"
                        label={isZh ? '退换/售后' : 'Returns'}
                        count={desktop && !afterSalesQuery.data ? undefined : activeAfterSalesCount}
                        onClick={() => navigateTo({ name: 'orders', tab: 'service' })}
                    />
                </AccountOrderCarousel>
            </section>

            {desktop && latestOrder ? (
                <article className="desktop-account-latest-order">
                    <button
                        type="button"
                        className="desktop-account-order-product"
                        onClick={() => navigateTo({ name: 'order-detail', id: latestOrder.id })}
                    >
                        <OrderImage order={latestOrder} />
                        <span>
                            <strong>
                                {latestOrder.lines[0]?.productVariant.name ||
                                    (isZh ? '订单商品' : 'Order item')}
                            </strong>
                            {latestOrder.lines.length > 1 && (
                                <small>
                                    {isZh
                                        ? `另有 ${latestOrder.lines.length - 1} 种商品，详情中可查看`
                                        : `${latestOrder.lines.length - 1} more products in order details`}
                                </small>
                            )}
                        </span>
                    </button>
                    <span>
                        {isZh ? `共 ${latestOrder.totalQuantity} 件` : `${latestOrder.totalQuantity} items`}
                    </span>
                    <strong>{formatMoney(latestOrder.totalWithTax, latestOrder.currencyCode, locale)}</strong>
                    <span>{orderStateLabel(latestOrder.state, language)}</span>
                    <button
                        type="button"
                        className="desktop-outline-button"
                        onClick={() => navigateTo({ name: 'order-detail', id: latestOrder.id })}
                    >
                        {isZh ? '查看订单' : 'View order'}
                    </button>
                </article>
            ) : null}

            {customer && !desktop && (
                <section
                    className={`account-latest-logistics ${accountSectionClass} [&>header]:mb-1 [&>header]:flex [&>header]:min-h-[26px] [&>header]:items-center [&>header]:justify-between [&>header>span]:flex [&>header>span]:items-center [&>header>span]:gap-1.5 [&>header>span]:text-[13.5px] [&>header_strong]:font-bold [&>header_strong]:text-[var(--text)] [&>button]:grid [&>button]:min-h-[52px] [&>button]:w-full [&>button]:grid-cols-[40px_minmax(0,1fr)_14px] [&>button]:items-center [&>button]:gap-2.5 [&>button]:rounded-[10px] [&>button]:px-2.5 [&>button]:py-1.5 [&>button]:text-left [&>button>img]:size-10 [&>button>.responsive-picture>img]:size-10 [&>button>.image-placeholder]:size-10 [&>button>img]:rounded-md [&>button>.responsive-picture]:rounded-md [&>button>.responsive-picture>img]:rounded-md [&>button>.image-placeholder]:rounded-md [&>button>span_strong]:text-[12.5px] [&>button>span_strong]:font-semibold [&>button>span_strong]:text-[var(--success)] [&>button>span_small]:mt-0.5 [&>button>span_small]:block [&>button>span_small]:text-[11.5px] [&>button>span_small]:text-[var(--muted)]`}
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

            <section
                className={`account-services ${accountSectionClass}`}
                aria-label={isZh ? '常用服务' : 'Services'}
            >
                <div className="account-service-grid grid grid-cols-4 gap-x-1 gap-y-1.5 lg:gap-4 [&>button]:flex [&>button]:min-h-14 [&>button]:min-w-0 [&>button]:flex-col [&>button]:items-center [&>button]:justify-center [&>button]:gap-1 [&>button]:rounded-lg [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-0.5 [&>button]:py-1 hover:[&>button]:bg-[var(--soft)] [&>button>span]:relative [&>button>span]:grid [&>button>span]:size-[34px] [&>button>span]:place-items-center [&>button>span]:rounded-[10px] [&>button>span]:bg-[var(--soft)] [&>button>span]:text-[var(--text)] [&>button>span]:transition-transform hover:[&>button>span]:-translate-y-0.5 hover:[&>button>span]:shadow-[0_4px_10px_rgba(0,0,0,0.08)] [&>button>span_svg]:size-5 [&>button>span_em]:absolute [&>button>span_em]:-right-2 [&>button>span_em]:-top-[5px] [&>button>span_em]:grid [&>button>span_em]:h-4 [&>button>span_em]:min-w-5 [&>button>span_em]:place-items-center [&>button>span_em]:rounded-full [&>button>span_em]:border-[1.5px] [&>button>span_em]:border-white [&>button>span_em]:bg-[var(--accent)] [&>button>span_em]:px-1 [&>button>span_em]:text-[9px] [&>button>span_em]:font-semibold [&>button>span_em]:not-italic [&>button>span_em]:leading-[13px] [&>button>span_em]:text-white [&>button>b]:max-w-full [&>button>b]:overflow-hidden [&>button>b]:text-ellipsis [&>button>b]:whitespace-nowrap [&>button>b]:text-xs [&>button>b]:font-medium [&>button>b]:text-[var(--text)]">
                    {!desktop && (
                        <ServiceButton
                            icon={<Heart />}
                            tone="support"
                            label={compactCopy.services.favorites}
                            badge={favoriteProductCount > 0 ? String(favoriteProductCount) : undefined}
                            onClick={() => navigateTo({ name: 'favorites' })}
                        />
                    )}
                    {!desktop && (
                        <ServiceButton
                            icon={<TicketPercent />}
                            tone="coupon"
                            label={compactCopy.services.coupons}
                            badge={couponCount > 0 ? String(couponCount) : undefined}
                            onClick={() => navigateTo({ name: 'coupons' })}
                        />
                    )}
                    {!desktop && (
                        <ServiceButton
                            icon={<MapPin />}
                            tone="security"
                            label={compactCopy.services.addresses}
                            onClick={() =>
                                customer ? navigateTo({ name: 'addresses' }) : navigateTo({ name: 'login' })
                            }
                        />
                    )}
                    <ServiceButton
                        icon={<Bell />}
                        tone="studio"
                        label={compactCopy.services.messages}
                        onClick={() => navigateTo({ name: 'notifications' })}
                    />
                    <ServiceButton
                        icon={<CircleCheck />}
                        tone="coupon"
                        label={compactCopy.services.reviews}
                        onClick={() => navigateTo({ name: 'reviews' })}
                    />
                    <ServiceButton
                        icon={<Headphones />}
                        tone="support"
                        label={compactCopy.services.support}
                        onClick={() => navigateTo({ name: 'support' })}
                    />
                    <ServiceButton
                        icon={<Store />}
                        tone="mail"
                        label={compactCopy.services.store}
                        onClick={() => navigateTo({ name: 'home' })}
                    />
                </div>
            </section>

            {!!recentVariants.length && (
                <section
                    className={`account-recent-purchases ${accountSectionClass} ${compactSectionHeaderClass} pt-0 lg:pt-0 [&>.section-header]:mb-0 [&>.section-header]:min-h-11 lg:[&>.section-header]:min-h-[52px] [&>div>article]:grid [&>div>article]:min-h-[68px] [&>div>article]:grid-cols-[54px_minmax(0,1fr)_auto] [&>div>article]:items-center [&>div>article]:gap-2.5 [&>div>article]:py-[7px] [&_article>img]:size-[54px] [&_article>.responsive-picture>img]:size-[54px] [&_article>.image-placeholder]:size-[54px] [&_article>img]:rounded-[7px] [&_article>.responsive-picture]:rounded-[7px] [&_article>.responsive-picture>img]:rounded-[7px] [&_article>.image-placeholder]:rounded-[7px] [&_article>img]:object-contain [&_article_strong]:block [&_article_strong]:overflow-hidden [&_article_strong]:text-ellipsis [&_article_strong]:whitespace-nowrap [&_article_small]:mt-1 [&_article_small]:block [&_article_small]:text-[var(--muted)] [&_article>button]:min-h-9 [&_article>button]:rounded-md [&_article>button]:px-2.5`}
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

            {!desktop && (
                <ProductSection
                    centerLabel={isZh ? '专属推荐' : 'Just for you'}
                    className={`account-recommendations${products.length === 1 ? ' account-recommendations-single' : ''}`}
                    products={products.slice(0, 4)}
                    market={market}
                    locale={locale}
                    language={language}
                    onProduct={product => navigateTo({ name: 'product', id: product.id })}
                />
            )}
            <LegalFooter
                storefrontName={storefrontName}
                language={language}
                onContentTarget={onContentTarget}
            />
        </main>
    );
}
