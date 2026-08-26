/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    Bell,
    CheckCircle2,
    ChevronRight,
    CircleCheck,
    ClipboardList,
    Clock3,
    Footprints,
    Headphones,
    Heart,
    MapPin,
    Navigation,
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
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import { languageCodeFor } from '../i18n';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import { ACCOUNT_RECOMMENDATION_CREST_IMAGE } from '../storefront-images';
import { routeNavigateOptions } from '../storefront-router';
import { orderStateLabel } from '../storefront-ui/order-ui';
import { AccountShortcut, LegalFooter, SectionHeader, ServiceButton } from '../storefront-ui/page-shell';
import { OrderImage, ProductVariantImage } from '../storefront-ui/product-display';
import { ProductSection } from '../storefront-ui/product-section';
import { useStorefront } from '../StorefrontContext';
import {
    ActiveCustomer,
    MarketConfig,
    Product,
    ProductVariant,
    StorefrontContentTargetType,
    StorefrontLanguage,
} from '../types';

// TODO: Fix internal imports later

interface AccountPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl: string | null;
    favoriteProductCount: number;
    recentProductCount: number;
    couponCount: number;
    addingVariantId: string | null;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    onAdd: (variant: ProductVariant) => void;
    onLogout: () => void;
}

const accountSectionClass =
    'mx-3 mt-2 rounded-[14px] border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.03)] lg:m-0 lg:w-full lg:rounded-2xl lg:px-5 lg:py-[18px]';
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
        recentProductCount,
        couponCount,
        addingVariantId,
        onContentTarget,
        onAdd,
        onLogout,
    } = useStorefront<AccountPageProps>();
    const isZh = language === 'zh';
    const orders = customer?.orders.items ?? [];
    const countsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerOrderCounts(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.customerOrderCounts(signal),
        enabled: !!customer,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const counts = countsQuery.data ?? { pending: 0, shipping: 0, receiving: 0 };
    const afterSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.afterSalesRequests(
            market.code,
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
        <main className="page pb-8 lg:grid lg:content-start lg:gap-4 lg:px-6 lg:pb-8 lg:pt-[88px]">
            <section
                className="relative m-0 overflow-hidden bg-[#b91c1c] bg-[radial-gradient(ellipse_90%_70%_at_85%_-10%,rgba(254,202,202,0.45)_0%,transparent_60%),radial-gradient(ellipse_80%_60%_at_15%_100%,rgba(253,164,175,0.35)_0%,transparent_60%),linear-gradient(145deg,#991b1b_0%,#c5221f_50%,#e11d48_100%)] px-3 pb-5 pt-4 text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_75%_20%,rgba(255,255,255,0.25)_0%,transparent_50%),radial-gradient(circle_at_20%_80%,rgba(255,255,255,0.15)_0%,transparent_40%)] before:content-[''] lg:col-span-full lg:rounded-2xl lg:px-7 lg:py-6"
                aria-labelledby={customer ? undefined : 'guest-account-title'}
            >
                {customer ? (
                    <div className="relative z-[1] flex flex-col items-center rounded-[18px] border border-white bg-white/95 px-3.5 pb-3.5 pt-4 text-center shadow-[0_12px_28px_-6px_rgba(153,27,27,0.22),0_4px_12px_-2px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                        <button
                            className="absolute right-3 top-3 z-[2] grid size-[34px] shrink-0 place-items-center rounded-full border border-slate-200/90 bg-white p-0 text-slate-600 shadow-[0_2px_6px_rgba(15,23,42,0.04)] transition-all duration-200 hover:rotate-[30deg] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 [&_svg]:size-4"
                            type="button"
                            title={isZh ? '账户与安全' : 'Account and security'}
                            aria-label={isZh ? '账户与安全' : 'Account and security'}
                            onClick={() => navigateTo({ name: 'account-security' })}
                        >
                            <Settings aria-hidden="true" />
                        </button>

                        <div className="flex w-full items-center gap-3.5 px-1 pb-1 pt-0.5 text-left">
                            <div className="mb-0 shrink-0 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(245,158,11,0.5),rgba(255,255,255,0.95))] p-[2.5px] shadow-[0_0_14px_rgba(245,158,11,0.25),0_3px_10px_rgba(15,23,42,0.08)]">
                                <button
                                    className="block rounded-full border-0 bg-transparent p-0"
                                    type="button"
                                    onClick={() => navigateTo({ name: 'account-security' })}
                                    aria-label={isZh ? '个人信息与安全' : 'Profile and security'}
                                >
                                    <span className="grid size-[54px] shrink-0 place-items-center rounded-full border-[2.5px] border-white bg-[linear-gradient(135deg,#3b82f6_0%,#2563eb_50%,#1d4ed8_100%)] text-[22px] font-extrabold text-white lg:size-16 lg:text-[26px]">
                                        {customerName.slice(0, 1).toUpperCase()}
                                    </span>
                                </button>
                            </div>

                            <div className="flex min-w-0 flex-1 flex-col items-start gap-[3px] text-left">
                                <h1 className="m-0 flex max-w-full items-center gap-1.5 text-[17px] font-extrabold tracking-[-0.01em] text-slate-900">
                                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                                        {customerName}
                                    </span>
                                    <CheckCircle2
                                        className="size-4 shrink-0 fill-blue-50 text-blue-600"
                                        aria-hidden="true"
                                    />
                                </h1>
                                <div className="flex max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-medium text-slate-500 [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-slate-400">
                                    <MapPin aria-hidden="true" />
                                    <span>
                                        {isZh ? '尊贵会员' : 'Premium Member'} · {customer.emailAddress}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div
                            className="mt-3 grid w-full grid-cols-3 gap-2"
                            role="group"
                            aria-label={isZh ? '账户资产' : 'Account assets'}
                        >
                            <button
                                type="button"
                                className="flex flex-col items-center gap-0.5 rounded-xl border border-[#eef2f6] bg-slate-50 px-1 pb-1.5 pt-2 shadow-[0_1px_3px_rgba(15,23,42,0.02)] transition-all duration-150 hover:border-slate-300 hover:bg-white hover:shadow-[0_2px_6px_rgba(15,23,42,0.05)] active:scale-95"
                                onClick={() => navigateTo({ name: 'favorites' })}
                            >
                                <span className="relative grid size-8 place-items-center rounded-[10px] border border-slate-200/90 bg-white text-blue-500 shadow-[0_1px_4px_rgba(15,23,42,0.04)] [&_svg]:size-4">
                                    <Heart aria-hidden="true" />
                                </span>
                                <b className="mt-[3px] text-[17px] font-extrabold leading-[1.1] tabular-nums text-slate-900">
                                    {favoriteProductCount}
                                </b>
                                <span className="text-[11px] font-semibold tracking-[0.01em] text-slate-500">
                                    {isZh ? '我的收藏' : 'Favorites'}
                                </span>
                            </button>

                            <button
                                type="button"
                                className="flex flex-col items-center gap-0.5 rounded-xl border border-[#eef2f6] bg-slate-50 px-1 pb-1.5 pt-2 shadow-[0_1px_3px_rgba(15,23,42,0.02)] transition-all duration-150 hover:border-slate-300 hover:bg-white hover:shadow-[0_2px_6px_rgba(15,23,42,0.05)] active:scale-95"
                                onClick={() => navigateTo({ name: 'coupons' })}
                            >
                                <span className="relative grid size-8 place-items-center rounded-[10px] border border-slate-200/90 bg-white text-blue-500 shadow-[0_1px_4px_rgba(15,23,42,0.04)] [&_svg]:size-4">
                                    <TicketPercent aria-hidden="true" />
                                    {couponCount > 0 && (
                                        <span className="absolute -right-0.5 -top-0.5 size-[7px] rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
                                    )}
                                </span>
                                <b className="mt-[3px] text-[17px] font-extrabold leading-[1.1] tabular-nums text-slate-900">
                                    {couponCount}
                                </b>
                                <span className="text-[11px] font-semibold tracking-[0.01em] text-slate-500">
                                    {isZh ? '优惠券' : 'Coupons'}
                                </span>
                            </button>

                            <button
                                type="button"
                                className="flex flex-col items-center gap-0.5 rounded-xl border border-[#eef2f6] bg-slate-50 px-1 pb-1.5 pt-2 shadow-[0_1px_3px_rgba(15,23,42,0.02)] transition-all duration-150 hover:border-slate-300 hover:bg-white hover:shadow-[0_2px_6px_rgba(15,23,42,0.05)] active:scale-95"
                                onClick={() => navigateTo({ name: 'history' })}
                            >
                                <span className="relative grid size-8 place-items-center rounded-[10px] border border-slate-200/90 bg-white text-blue-500 shadow-[0_1px_4px_rgba(15,23,42,0.04)] [&_svg]:size-4">
                                    <Footprints aria-hidden="true" />
                                </span>
                                <b className="mt-[3px] text-[17px] font-extrabold leading-[1.1] tabular-nums text-slate-900">
                                    {recentProductCount}
                                </b>
                                <span className="text-[11px] font-semibold tracking-[0.01em] text-slate-500">
                                    {isZh ? '浏览足迹' : 'Footprint'}
                                </span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="relative z-[1] flex flex-col items-center gap-2.5 rounded-[18px] border border-white bg-white/95 px-3.5 pb-3.5 pt-4 text-center shadow-[0_12px_28px_-6px_rgba(153,27,27,0.22),0_4px_12px_-2px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                        <div className="flex w-full items-center gap-3.5 px-1 pb-1 pt-0.5 text-left">
                            <div className="mb-0 shrink-0 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(245,158,11,0.5),rgba(255,255,255,0.95))] p-[2.5px] shadow-[0_0_14px_rgba(245,158,11,0.25),0_3px_10px_rgba(15,23,42,0.08)]">
                                <span className="grid size-[54px] shrink-0 place-items-center rounded-full border-[2.5px] border-white bg-[linear-gradient(135deg,#94a3b8_0%,#64748b_100%)] text-white lg:size-16 [&_svg]:size-[26px]">
                                    <UserRound aria-hidden="true" />
                                </span>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col items-start gap-[3px] text-left">
                                <h1
                                    id="guest-account-title"
                                    className="m-0 flex max-w-full items-center gap-1.5 text-[17px] font-extrabold tracking-[-0.01em] text-slate-900"
                                >
                                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                                        {isZh ? `欢迎来到 ${storefrontName}` : `Welcome to ${storefrontName}`}
                                    </span>
                                </h1>
                                <div className="flex max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-medium text-slate-500">
                                    <span>
                                        {isZh
                                            ? '登录后享受会员特权与专属优惠'
                                            : 'Sign in to enjoy member perks & discounts'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="mt-2 grid w-full grid-cols-2 gap-2 [&_button]:h-10 [&_button]:rounded-full [&_button]:text-[13.5px] [&_button]:font-bold [&_button]:transition-all [&_button]:duration-200">
                            <button
                                type="button"
                                className="border-0 bg-[var(--accent)] text-white shadow-[0_4px_14px_rgba(211,60,48,0.28)] hover:bg-[var(--accent-hover)]"
                                onClick={() => navigateTo({ name: 'login' })}
                            >
                                {isZh ? '立即登录' : 'Sign in'}
                            </button>
                            <button
                                type="button"
                                className="border border-slate-300 bg-white text-slate-900 shadow-[0_2px_6px_rgba(15,23,42,0.04)] hover:border-slate-400 hover:bg-slate-50"
                                onClick={() => navigateTo({ name: 'register' })}
                            >
                                {isZh ? '免费注册' : 'Register'}
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section
                className={`${accountSectionClass} ${compactSectionHeaderClass} [&_nav]:mt-1 [&_nav]:grid [&_nav]:grid-cols-5 [&_nav]:gap-0.5 [&_nav>button]:flex [&_nav>button]:min-h-[52px] [&_nav>button]:min-w-0 [&_nav>button]:flex-col [&_nav>button]:items-center [&_nav>button]:justify-center [&_nav>button]:gap-1 [&_nav>button]:rounded-lg [&_nav>button]:border-0 [&_nav>button]:bg-transparent [&_nav>button]:px-0.5 [&_nav>button]:py-1 hover:[&_nav>button]:bg-[var(--soft)] [&_nav>button>span]:relative [&_nav>button>span]:grid [&_nav>button>span]:size-[26px] [&_nav>button>span]:place-items-center [&_nav>button>span]:text-slate-800 [&_nav>button>span_svg]:size-5 [&_nav>button>span_svg]:stroke-[1.8] [&_nav>button>span_b]:absolute [&_nav>button>span_b]:-right-2 [&_nav>button>span_b]:-top-1 [&_nav>button>span_b]:grid [&_nav>button>span_b]:h-4 [&_nav>button>span_b]:min-w-4 [&_nav>button>span_b]:place-items-center [&_nav>button>span_b]:rounded-full [&_nav>button>span_b]:border-2 [&_nav>button>span_b]:border-white [&_nav>button>span_b]:bg-[var(--danger)] [&_nav>button>span_b]:px-1 [&_nav>button>span_b]:text-[10px] [&_nav>button>span_b]:font-semibold [&_nav>button>span_b]:leading-3 [&_nav>button>span_b]:text-white [&_nav>button_small]:max-w-full [&_nav>button_small]:overflow-hidden [&_nav>button_small]:text-ellipsis [&_nav>button_small]:whitespace-nowrap [&_nav>button_small]:text-xs [&_nav>button_small]:font-medium [&_nav>button_small]:text-[var(--text)] [&_nav>button:nth-child(1)>span_svg]:text-amber-500 [&_nav>button:nth-child(2)>span_svg]:text-sky-600 [&_nav>button:nth-child(3)>span_svg]:text-indigo-600 [&_nav>button:nth-child(4)>span_svg]:text-rose-600 [&_nav>button:nth-child(5)>span_svg]:text-teal-600`}
            >
                <SectionHeader
                    title={isZh ? '我的订单' : 'My orders'}
                    action={isZh ? '全部订单' : 'All orders'}
                    onAction={() => navigateTo({ name: 'orders', tab: 'all' })}
                />
                <nav>
                    <AccountShortcut
                        icon={<WalletCards />}
                        label={isZh ? '待付款' : 'To pay'}
                        count={counts.pending}
                        onClick={() => navigateTo({ name: 'orders', tab: 'pending' })}
                    />
                    <AccountShortcut
                        icon={<Package />}
                        label={isZh ? '待发货' : 'To ship'}
                        count={counts.shipping}
                        onClick={() => navigateTo({ name: 'orders', tab: 'shipping' })}
                    />
                    <AccountShortcut
                        icon={<Truck />}
                        label={isZh ? '待收货' : 'To receive'}
                        count={counts.receiving}
                        onClick={() => navigateTo({ name: 'orders', tab: 'receiving' })}
                    />
                    <AccountShortcut
                        icon={<RotateCcw />}
                        label={isZh ? '退款/售后' : 'After-sales'}
                        count={activeAfterSalesCount}
                        onClick={() => navigateTo({ name: 'orders', tab: 'service' })}
                    />
                    <AccountShortcut
                        icon={<ClipboardList />}
                        label={isZh ? '全部订单' : 'All orders'}
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
                        <span>
                            <Navigation />
                            <strong>{isZh ? '最新物流' : 'Latest delivery'}</strong>
                        </span>
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
                        <div className="flex min-h-11 items-center gap-2 py-1 text-[12.5px] text-[var(--muted)] [&>svg]:size-6 [&>svg]:rounded-md [&>svg]:bg-[var(--soft)] [&>svg]:p-1 [&>svg]:text-[var(--muted)] [&_small]:block">
                            <Package aria-hidden="true" />
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
                <div className="grid grid-cols-4 gap-x-1 gap-y-1.5 lg:gap-4 [&>button]:flex [&>button]:min-h-14 [&>button]:min-w-0 [&>button]:flex-col [&>button]:items-center [&>button]:justify-center [&>button]:gap-1 [&>button]:rounded-lg [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-0.5 [&>button]:py-1 hover:[&>button]:bg-[var(--soft)] [&>button>span]:relative [&>button>span]:grid [&>button>span]:size-[34px] [&>button>span]:place-items-center [&>button>span]:rounded-[10px] [&>button>span]:bg-[var(--soft)] [&>button>span]:text-[var(--text)] [&>button>span]:transition-all hover:[&>button>span]:-translate-y-0.5 hover:[&>button>span]:shadow-[0_4px_10px_rgba(0,0,0,0.08)] [&>button>span_svg]:size-5 [&>button:nth-child(1)>span]:bg-rose-50 [&>button:nth-child(1)>span]:text-rose-500 [&>button:nth-child(2)>span]:bg-red-50 [&>button:nth-child(2)>span]:text-red-500 [&>button:nth-child(3)>span]:bg-amber-50 [&>button:nth-child(3)>span]:text-amber-500 [&>button:nth-child(4)>span]:bg-emerald-50 [&>button:nth-child(4)>span]:text-emerald-500 [&>button:nth-child(5)>span]:bg-sky-50 [&>button:nth-child(5)>span]:text-sky-500 [&>button:nth-child(6)>span]:bg-indigo-50 [&>button:nth-child(6)>span]:text-indigo-500 [&>button:nth-child(7)>span]:bg-violet-50 [&>button:nth-child(7)>span]:text-violet-500 [&>button:nth-child(8)>span]:bg-slate-100 [&>button:nth-child(8)>span]:text-slate-600 [&>button>span_em]:absolute [&>button>span_em]:-right-2 [&>button>span_em]:-top-[5px] [&>button>span_em]:grid [&>button>span_em]:h-4 [&>button>span_em]:min-w-5 [&>button>span_em]:place-items-center [&>button>span_em]:rounded-full [&>button>span_em]:border-[1.5px] [&>button>span_em]:border-white [&>button>span_em]:bg-[var(--accent)] [&>button>span_em]:px-1 [&>button>span_em]:text-[9px] [&>button>span_em]:font-semibold [&>button>span_em]:not-italic [&>button>span_em]:leading-[13px] [&>button>span_em]:text-white [&>button>b]:max-w-full [&>button>b]:overflow-hidden [&>button>b]:text-ellipsis [&>button>b]:whitespace-nowrap [&>button>b]:text-xs [&>button>b]:font-medium [&>button>b]:text-[var(--text)]">
                    <ServiceButton
                        icon={<Heart />}
                        label={
                            favoriteProductCount
                                ? isZh
                                    ? `收藏 ${favoriteProductCount}`
                                    : `Favorites ${favoriteProductCount}`
                                : isZh
                                  ? '我的收藏'
                                  : 'Favorites'
                        }
                        onClick={() => navigateTo({ name: 'favorites' })}
                    />
                    <ServiceButton
                        icon={<TicketPercent />}
                        label={isZh ? '优惠券' : 'Coupons'}
                        badge={couponCount > 0 ? String(couponCount) : undefined}
                        onClick={() => navigateTo({ name: 'coupons' })}
                    />
                    <ServiceButton
                        icon={<Clock3 />}
                        label={
                            recentProductCount
                                ? isZh
                                    ? `足迹 ${recentProductCount}`
                                    : `History ${recentProductCount}`
                                : isZh
                                  ? '浏览足迹'
                                  : 'History'
                        }
                        onClick={() => navigateTo({ name: 'history' })}
                    />
                    <ServiceButton
                        icon={<MapPin />}
                        label={isZh ? '地址管理' : 'Addresses'}
                        onClick={() =>
                            customer ? navigateTo({ name: 'addresses' }) : navigateTo({ name: 'login' })
                        }
                    />
                    <ServiceButton
                        icon={<Bell />}
                        label={isZh ? '消息通知' : 'Notifications'}
                        onClick={() => navigateTo({ name: 'notifications' })}
                    />
                    <ServiceButton
                        icon={<CircleCheck />}
                        label={isZh ? '评价中心' : 'Reviews'}
                        onClick={() => navigateTo({ name: 'reviews' })}
                    />
                    <ServiceButton
                        icon={<Headphones />}
                        label={isZh ? '客服中心' : 'Support'}
                        onClick={() => navigateTo({ name: 'support' })}
                    />
                    <ServiceButton
                        icon={<Store />}
                        label={isZh ? '店铺首页' : 'Store home'}
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
                                    <small>{variant.sku}</small>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => onAdd(variant)}
                                    disabled={addingVariantId === variant.id}
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
                addingVariantId={addingVariantId}
                onProduct={product => navigateTo({ name: 'product', id: product.id })}
                onAdd={onAdd}
            />
            <LegalFooter
                storefrontName={storefrontName}
                language={language}
                onContentTarget={onContentTarget}
            />
        </main>
    );
}
