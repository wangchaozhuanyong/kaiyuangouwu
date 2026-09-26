import {
    CheckCircle2,
    ChevronRight,
    Headphones,
    Package,
    RotateCcw,
    Star,
    Truck,
    WalletCards,
} from 'lucide-react';

import { RouteState } from '../storefront-router';
import { orderStateLabel } from '../storefront-ui/order-ui';
import { LegalFooter, SectionIcon } from '../storefront-ui/page-shell';
import { formatMoney, OrderImage } from '../storefront-ui/product-display';
import { ProductSection } from '../storefront-ui/product-section';
import { CustomerOrderCounts } from '../types';

import { AccountPageProps } from './account-page';

interface DesktopAccountPageProps extends Omit<
    AccountPageProps,
    'api' | 'logoUrl' | 'accountHeroImageUrl' | 'onLogout'
> {
    pending: boolean;
    counts: CustomerOrderCounts | undefined;
    countsError: boolean;
    onRetryCounts: () => void;
    afterSalesCount: number | undefined;
    referralEnabled: boolean;
    referralBalance: number | undefined;
    navigate: (route: RouteState) => void;
}

export function DesktopAccountPage({
    pending,
    customer,
    products,
    market,
    locale,
    language,
    storefrontName,
    favoriteProductCount,
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
        {
            tab: 'pending',
            label: isZh ? '待付款' : 'Unpaid',
            count: counts?.pending,
            Icon: WalletCards,
            tone: 'coupon',
        },
        {
            tab: 'shipping',
            label: isZh ? '待发货' : 'Processing',
            count: counts?.shipping,
            Icon: Package,
            tone: 'security',
        },
        {
            tab: 'receiving',
            label: isZh ? '待收货' : 'Shipped',
            count: counts?.receiving,
            Icon: Truck,
            tone: 'studio',
        },
        {
            tab: 'completed',
            label: isZh ? '已完成' : 'Completed',
            count: counts?.completed,
            Icon: CheckCircle2,
            tone: 'mail',
        },
        {
            tab: 'service',
            label: isZh ? '售后' : 'Returns',
            count: afterSalesCount,
            Icon: RotateCcw,
            tone: 'support',
        },
    ] as const;
    const delivery = orders.find(order =>
        order.lines.some(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        ),
    );
    return (
        <main className="page desktop-account-page" data-page-pending={pending ? 'query' : undefined}>
            <h1 className="desktop-account-page-title">{isZh ? '账户概览' : 'Account overview'}</h1>
            <section className="desktop-member-summary" aria-label={isZh ? '账户信息' : 'Account details'}>
                <div className="desktop-member-identity">
                    <div>
                        <h2>
                            {customer
                                ? `${isZh ? '你好，' : 'Hello, '}${name}`
                                : isZh
                                  ? '欢迎来到店铺'
                                  : 'Welcome to the store'}
                        </h2>
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
                    className="desktop-account-continue"
                    onClick={() => navigate({ name: 'home' })}
                    type="button"
                >
                    {isZh ? '继续逛逛' : 'Continue shopping'}
                    <ChevronRight />
                </button>
                <div className="desktop-member-assets">
                    <button
                        className="desktop-member-asset"
                        type="button"
                        onClick={() => navigate({ name: 'coupons' })}
                    >
                        <span className="desktop-member-asset-label">
                            <WalletCards aria-hidden="true" />
                            {isZh ? '优惠券' : 'Coupons'}
                        </span>
                        <strong>{couponCount}</strong>
                        <small>{isZh ? '查看活动与使用条件' : 'Offers and conditions'}</small>
                    </button>
                    <button
                        className="desktop-member-asset"
                        type="button"
                        onClick={() => navigate({ name: 'favorites' })}
                    >
                        <span className="desktop-member-asset-label">
                            <Star aria-hidden="true" />
                            {isZh ? '收藏商品' : 'Favorites'}
                        </span>
                        <strong>{favoriteProductCount}</strong>
                        <small>{isZh ? '收藏喜欢的商品' : 'Your saved products'}</small>
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
                </div>
            </section>
            <section className="desktop-account-orders" aria-labelledby="desktop-my-orders">
                <header>
                    <h2 id="desktop-my-orders">
                        <SectionIcon kind="orders" />
                        {isZh ? '我的订单' : 'My orders'}
                    </h2>
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
                            <span
                                className="desktop-order-status-icon"
                                data-icon-tone={status.tone}
                                aria-hidden="true"
                            >
                                <status.Icon />
                            </span>
                            <span>{status.label}</span>
                            <strong>{customer ? (status.count ?? '—') : '—'}</strong>
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
            </section>
            <section
                className="desktop-account-orders desktop-account-recent"
                aria-labelledby="desktop-recent-orders"
            >
                <header>
                    <h2 id="desktop-recent-orders">
                        <SectionIcon kind="history" />
                        {isZh ? '最近订单' : 'Recent orders'}
                    </h2>
                    <button type="button" onClick={() => navigate({ name: 'orders', tab: 'all' })}>
                        {isZh ? '查看全部' : 'View all'}
                        <ChevronRight />
                    </button>
                </header>
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
                        <h2>
                            <SectionIcon kind="history" />
                            {isZh ? '物流动态' : 'Delivery updates'}
                        </h2>
                        <button type="button" onClick={() => navigate({ name: 'logistics' })}>
                            {isZh ? '查看物流' : 'View delivery'}
                            <ChevronRight />
                        </button>
                    </header>
                    <div className="desktop-delivery-summary">
                        {delivery ? <OrderImage order={delivery} /> : <Truck aria-hidden="true" />}
                        <div>
                            {delivery && (
                                <strong>{delivery.lines[0]?.productVariant.name || delivery.code}</strong>
                            )}
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
                    {delivery && (
                        <button
                            type="button"
                            className="desktop-delivery-action"
                            onClick={() => navigate({ name: 'order-detail', id: delivery.id })}
                        >
                            {isZh ? '查看订单详情' : 'View order details'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    )}
                </section>
                <section>
                    <header>
                        <h2>
                            <SectionIcon kind="support" />
                            {isZh ? '店铺与帮助' : 'Store and help'}
                        </h2>
                    </header>
                    <div className="desktop-account-help">
                        <button type="button" onClick={() => navigate({ name: 'support' })}>
                            <Headphones aria-hidden="true" />
                            <span>
                                <strong>{isZh ? '联系客服' : 'Customer service'}</strong>
                                <small>
                                    {isZh ? '商品、订单与售后咨询' : 'Products, orders and after-sales'}
                                </small>
                            </span>
                            <ChevronRight aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => navigate({ name: 'reviews' })}>
                            <Star aria-hidden="true" />
                            <span>
                                <strong>{isZh ? '评价中心' : 'Reviews'}</strong>
                                <small>{isZh ? '分享你的使用体验' : 'Share your experience'}</small>
                            </span>
                            <ChevronRight aria-hidden="true" />
                        </button>
                    </div>
                </section>
            </div>
            {products.length > 0 && (
                <ProductSection
                    className="desktop-account-recommendations"
                    kind="recommendations"
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
