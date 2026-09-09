import { ChevronRight, Headphones, Package, Truck, UserRound } from 'lucide-react';

import { RouteState } from '../storefront-router';
import { orderStateLabel } from '../storefront-ui/order-ui';
import { LegalFooter } from '../storefront-ui/page-shell';
import { formatMoney, OrderImage } from '../storefront-ui/product-display';
import { ProductSection } from '../storefront-ui/product-section';
import { CustomerOrderCounts } from '../types';

import { AccountPageProps } from './account-page';

interface DesktopAccountPageProps extends Omit<
    AccountPageProps,
    'api' | 'logoUrl' | 'accountHeroImageUrl' | 'onLogout'
> {
    counts: CustomerOrderCounts | undefined;
    countsError: boolean;
    onRetryCounts: () => void;
    afterSalesCount: number | undefined;
    referralEnabled: boolean;
    referralBalance: number | undefined;
    navigate: (route: RouteState) => void;
}

export function DesktopAccountPage({
    customer,
    products,
    market,
    locale,
    language,
    storefrontName,
    favoriteProductCount,
    announcementCount,
    couponCount,
    onContentTarget,
    counts,
    countsError,
    onRetryCounts,
    afterSalesCount,
    referralEnabled,
    referralBalance,
    navigate,
}: DesktopAccountPageProps) {
    const isZh = language === 'zh';
    const orders = customer?.orders.items ?? [];
    const name = customer ? `${customer.lastName}${customer.firstName}`.trim() || customer.emailAddress : '';
    const statuses = [
        { tab: 'pending', label: isZh ? '待付款' : 'Unpaid', count: counts?.pending },
        { tab: 'shipping', label: isZh ? '待发货' : 'Processing', count: counts?.shipping },
        { tab: 'receiving', label: isZh ? '待收货' : 'Shipped', count: counts?.receiving },
        { tab: 'service', label: isZh ? '退款 / 售后' : 'Returns', count: afterSalesCount },
    ] as const;
    const delivery = orders.find(order =>
        order.lines.some(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        ),
    );
    return (
        <main className="page desktop-account-page">
            <div className="desktop-account-heading">
                <h1>{isZh ? '账户概览' : 'Account overview'}</h1>
                <button onClick={() => navigate({ name: 'home' })} type="button">
                    {isZh ? '继续逛逛' : 'Continue shopping'}
                    <ChevronRight />
                </button>
            </div>
            <section className="desktop-member-summary" aria-label={isZh ? '账户信息' : 'Account details'}>
                <div className="desktop-member-identity">
                    <span className="desktop-member-avatar">
                        {customer?.avatar?.preview ? (
                            <img src={customer.avatar.preview} alt="" />
                        ) : (
                            <UserRound aria-hidden="true" />
                        )}
                    </span>
                    <div>
                        <h2>{customer ? name : isZh ? '欢迎来到店铺' : 'Welcome to the store'}</h2>
                        <button
                            type="button"
                            onClick={() => navigate({ name: customer ? 'account-security' : 'login' })}
                        >
                            {customer
                                ? isZh
                                    ? '个人资料与账户安全'
                                    : 'Profile and security'
                                : isZh
                                  ? '登录 / 注册'
                                  : 'Sign in / Register'}
                            <ChevronRight />
                        </button>
                    </div>
                </div>
                <button
                    className="desktop-member-asset"
                    type="button"
                    onClick={() => navigate({ name: 'coupons' })}
                >
                    <strong>{couponCount}</strong>
                    <span>{isZh ? '优惠券' : 'Coupons'}</span>
                </button>
                <button
                    className="desktop-member-asset"
                    type="button"
                    onClick={() => navigate({ name: 'favorites' })}
                >
                    <strong>{favoriteProductCount}</strong>
                    <span>{isZh ? '收藏商品' : 'Favorites'}</span>
                </button>
                {referralEnabled && (
                    <button
                        className="desktop-member-asset"
                        type="button"
                        onClick={() => navigate({ name: 'referral' })}
                    >
                        <strong>
                            {referralBalance == null
                                ? '—'
                                : formatMoney(referralBalance, market.currencyCode, locale)}
                        </strong>
                        <span>{isZh ? '返利余额' : 'Referral balance'}</span>
                    </button>
                )}
            </section>
            <section className="desktop-account-orders" aria-labelledby="desktop-my-orders">
                <header>
                    <h2 id="desktop-my-orders">{isZh ? '我的订单' : 'My orders'}</h2>
                    <button type="button" onClick={() => navigate({ name: 'orders', tab: 'all' })}>
                        {isZh ? '查看全部订单' : 'View all orders'}
                        <ChevronRight />
                    </button>
                </header>
                <nav
                    className="desktop-order-statuses"
                    aria-label={isZh ? '按状态查看订单' : 'Orders by status'}
                >
                    {statuses.map(status => (
                        <button
                            key={status.tab}
                            type="button"
                            onClick={() => navigate({ name: 'orders', tab: status.tab })}
                        >
                            <span>{status.label}</span>
                            <strong>{customer ? (status.count ?? '—') : '—'}</strong>
                            <ChevronRight />
                        </button>
                    ))}
                </nav>
                {countsError && (
                    <p className="desktop-account-query-error" role="status">
                        {isZh ? '订单数量暂时无法加载' : 'Order counts are unavailable'}
                        <button type="button" onClick={onRetryCounts}>
                            {isZh ? '重试' : 'Retry'}
                        </button>
                    </p>
                )}
                {orders.length ? (
                    <div className="desktop-recent-orders">
                        {orders.slice(0, 3).map(order => (
                            <article key={order.id}>
                                <button
                                    type="button"
                                    className="desktop-order-product"
                                    onClick={() => navigate({ name: 'order-detail', id: order.id })}
                                >
                                    <OrderImage order={order} />
                                    <span>
                                        <strong>{order.lines[0]?.productVariant.name || order.code}</strong>
                                        <small>
                                            {isZh ? '订单号' : 'Order'} {order.code}
                                        </small>
                                    </span>
                                </button>
                                <span>{orderStateLabel(order.state, language)}</span>
                                <strong>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</strong>
                                <button
                                    type="button"
                                    onClick={() => navigate({ name: 'order-detail', id: order.id })}
                                >
                                    {isZh ? '订单详情' : 'View order'}
                                </button>
                            </article>
                        ))}
                    </div>
                ) : (
                    <div className="desktop-orders-empty">
                        <Package aria-hidden="true" />
                        <div>
                            <strong>
                                {isZh
                                    ? customer
                                        ? '你还没有订单'
                                        : '登录后查看你的订单'
                                    : customer
                                      ? 'No orders yet'
                                      : 'Sign in to view your orders'}
                            </strong>
                            <p>
                                {isZh
                                    ? '购买记录、订单进度和售后都可以在这里查看。'
                                    : 'Keep track of your purchases, deliveries and returns here.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate({ name: customer ? 'category' : 'login' })}
                        >
                            {isZh
                                ? customer
                                    ? '去选购商品'
                                    : '立即登录'
                                : customer
                                  ? 'Browse products'
                                  : 'Sign in'}
                        </button>
                    </div>
                )}
            </section>
            <div className="desktop-account-detail-grid">
                <section>
                    <header>
                        <h2>{isZh ? '物流动态' : 'Delivery updates'}</h2>
                        <button type="button" onClick={() => navigate({ name: 'logistics' })}>
                            {isZh ? '查看物流' : 'View delivery'}
                            <ChevronRight />
                        </button>
                    </header>
                    <div className="desktop-delivery-summary">
                        <Truck aria-hidden="true" />
                        <div>
                            <strong>
                                {delivery
                                    ? orderStateLabel(delivery.state, language)
                                    : isZh
                                      ? '暂无进行中的物流'
                                      : 'No delivery updates'}
                            </strong>
                            <p>
                                {delivery
                                    ? `${isZh ? '订单号' : 'Order'} ${delivery.code}`
                                    : isZh
                                      ? '商品发货后，在这里跟进配送进度。'
                                      : 'Delivery updates appear after your order ships.'}
                            </p>
                        </div>
                    </div>
                </section>
                <section>
                    <header>
                        <h2>{isZh ? '店铺与帮助' : 'Store and help'}</h2>
                        <Headphones aria-hidden="true" />
                    </header>
                    <div className="desktop-account-help">
                        <button type="button" onClick={() => navigate({ name: 'support' })}>
                            {isZh ? '联系客服' : 'Customer service'}
                            <ChevronRight />
                        </button>
                        <button type="button" onClick={() => navigate({ name: 'announcements' })}>
                            {isZh ? '店铺公告' : 'Store notices'}
                            {announcementCount > 0 && <small>{announcementCount}</small>}
                            <ChevronRight />
                        </button>
                    </div>
                </section>
            </div>
            {products.length > 0 && (
                <ProductSection
                    title={isZh ? '为你推荐' : 'Recommended for you'}
                    products={products.slice(0, 4)}
                    market={market}
                    locale={locale}
                    language={language}
                    onProduct={product => navigate({ name: 'product', id: product.id })}
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
