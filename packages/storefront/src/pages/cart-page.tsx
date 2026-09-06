import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronRight, Minus, Package, ShoppingBag, TicketPercent } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { appliedCouponLabel } from '../storefront-coupons';
import { CartPageContext } from '../storefront-page-contexts';
import { routeHref, routeNavigateOptions, type RouteState } from '../storefront-router';
import { CartGroup, CouponSheet } from '../storefront-ui/cart-ui';
import { EmptyState, InlineError, ListSkeleton } from '../storefront-ui/page-shell';
import { formatMoney } from '../storefront-ui/product-display';
import { ProductSection } from '../storefront-ui/product-section';
import {
    ActiveCustomer,
    MarketConfig,
    Product,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontLanguage,
} from '../types';

// TODO: Fix internal imports later

export interface CartPageProps {
    isActive?: boolean;
    cart: StorefrontCart | null;
    customer: ActiveCustomer | null;
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    loading: boolean;
    selectionPending?: boolean;
    editingBlocked?: boolean;
    commandUnknown?: boolean;
    onCancelPending?: () => void;
    error: string | null;
    favoriteProductIds: string[];
    coupons: StoreCustomerCoupon[];
    onToggleAll: () => void;
    onSelect: (lineId: string, selected: boolean) => void;
    onSelectGroup: (lineIds: string[], selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
    onFavorite: (productId: string) => void;
    onCheckout: () => void;
    onReopen: () => void;
    onNotify: (message: string) => void;
    onRetry: () => void;
    onApplyCoupon: (customerCouponId: string) => Promise<string | null>;
    onRemoveCoupon: (customerCouponId: string) => Promise<string | null>;
}

export function CartPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const {
        isActive = true,
        cart,
        customer,
        products,
        market,
        locale,
        language,
        loading,
        selectionPending = false,
        editingBlocked = false,
        commandUnknown = false,
        onCancelPending,
        error,
        favoriteProductIds,
        coupons,
        onToggleAll,
        onSelect,
        onSelectGroup,
        onQuantity,
        onRemove,
        onFavorite,
        onCheckout,
        onReopen,
        onNotify,
        onRetry,
        onApplyCoupon,
        onRemoveCoupon,
    } = CartPageContext.useValue();
    const isZh = language === 'zh';
    const lines = cart?.lines ?? [];
    const [invalidOpen, setInvalidOpen] = useState(false);
    const [couponOpen, setCouponOpen] = useState(false);
    const [openActionLineId, setOpenActionLineId] = useState<string | null>(null);
    const [pinnedLineIds, setPinnedLineIds] = useState<string[]>([]);
    const activeLines = lines.filter(line => line.available && line.productVariant);
    const invalidLines = lines.filter(line => !line.available || !line.productVariant);
    const physical = activeLines.filter(
        line => line.productVariant?.customFields.fulfillmentType === 'physical',
    );
    const digital = activeLines.filter(
        line => line.productVariant?.customFields.fulfillmentType === 'digital',
    );
    const digitalOnly = digital.length > 0 && physical.length === 0;
    const order = cart?.checkoutOrder;
    const selectedCouponLabel = order ? appliedCouponLabel(coupons, order.id, language) : null;
    const locked = cart?.state === 'PAYMENT_PENDING';
    const discount = Math.abs(order?.discounts.reduce((sum, item) => sum + item.amountWithTax, 0) ?? 0);
    const amount = locked && order ? order.totalWithTax : (order?.subTotalWithTax ?? 0);

    const [isCheckoutBarHidden, setIsCheckoutBarHidden] = useState(false);
    const lastScrollY = useRef(0);

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            if (currentScrollY > 60 && currentScrollY > lastScrollY.current + 5) {
                setIsCheckoutBarHidden(true);
            } else if (currentScrollY < lastScrollY.current - 5 || currentScrollY <= 20) {
                setIsCheckoutBarHidden(false);
            }
            lastScrollY.current = currentScrollY;
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        const currentLineIds = new Set(lines.map(line => line.id));
        setPinnedLineIds(current => {
            const next = current.filter(lineId => currentLineIds.has(lineId));
            return next.length === current.length ? current : next;
        });
        setOpenActionLineId(current => (current && currentLineIds.has(current) ? current : null));
    }, [lines]);

    const sortPinnedLines = useCallback(
        (groupLines: StorefrontCart['lines']) =>
            [...groupLines].sort((left, right) => {
                const leftIndex = pinnedLineIds.indexOf(left.id);
                const rightIndex = pinnedLineIds.indexOf(right.id);
                if (leftIndex === -1 && rightIndex === -1) return 0;
                if (leftIndex === -1) return 1;
                if (rightIndex === -1) return -1;
                return leftIndex - rightIndex;
            }),
        [pinnedLineIds],
    );

    const togglePinnedLine = (lineId: string, productName: string) => {
        const pinning = !pinnedLineIds.includes(lineId);
        setPinnedLineIds(current =>
            pinning
                ? [lineId, ...current.filter(currentId => currentId !== lineId)]
                : current.filter(currentId => currentId !== lineId),
        );
        setOpenActionLineId(null);
        onNotify(
            pinning
                ? isZh
                    ? `${productName} 已置顶`
                    : `${productName} pinned`
                : isZh
                  ? `${productName} 已取消置顶`
                  : `${productName} unpinned`,
        );
    };

    const toggleFavoriteLine = (productId: string, productName: string) => {
        const saving = !favoriteProductIds.includes(productId);
        onFavorite(productId);
        setOpenActionLineId(null);
        onNotify(
            saving
                ? isZh
                    ? `${productName} 已收藏`
                    : `${productName} saved`
                : isZh
                  ? `${productName} 已取消收藏`
                  : `${productName} removed from favorites`,
        );
    };

    const shareCartProduct = async (productId: string, productName: string) => {
        const productUrl = new URL(window.location.href);
        const productHref = new URL(routeHref({ name: 'product', id: productId }), productUrl.origin);
        productUrl.pathname = productHref.pathname;
        productUrl.search = productHref.search;
        productUrl.hash = '';
        try {
            if (navigator.share) {
                await navigator.share({ title: productName, url: productUrl.toString() });
            } else {
                await navigator.clipboard.writeText(productUrl.toString());
                onNotify(isZh ? '商品链接已复制' : 'Product link copied');
            }
            setOpenActionLineId(null);
        } catch (shareError) {
            if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
            onNotify(isZh ? '暂时无法分享商品' : 'Could not share this product');
        }
    };

    return (
        <main className={`page cart-page${!lines.length ? ' is-empty' : ''}`}>
            <header className="topbar cart-topbar">
                <h1 className="topbar-title">{isZh ? '我的购物车' : 'My Cart'}</h1>
                {!!lines.length && (
                    <button
                        className={`select-all ${(cart?.selectionState ?? 'NONE').toLowerCase()}`}
                        type="button"
                        onClick={onToggleAll}
                        disabled={editingBlocked || (loading && !selectionPending) || locked}
                    >
                        <span>
                            {cart?.selectionState === 'ALL' ? (
                                <Check />
                            ) : cart?.selectionState === 'PARTIAL' ? (
                                <Minus />
                            ) : null}
                        </span>
                        <b>
                            {cart?.selectionState === 'ALL'
                                ? isZh
                                    ? `已全选 ${cart.selectedQuantity}件`
                                    : `All ${cart.selectedQuantity}`
                                : cart?.selectionState === 'PARTIAL'
                                  ? isZh
                                      ? `已选 ${cart.selectedQuantity}/${cart.totalQuantity}件`
                                      : `${cart.selectedQuantity}/${cart.totalQuantity} selected`
                                  : isZh
                                    ? `全选 ${cart?.totalQuantity ?? 0}件`
                                    : `Select all ${cart?.totalQuantity ?? 0}`}
                        </b>
                    </button>
                )}
            </header>

            {commandUnknown && (
                <button type="button" className="secondary-button" onClick={onCancelPending}>
                    {isZh ? '取消待确认操作并核对购物车' : 'Cancel pending operation and reconcile cart'}
                </button>
            )}
            {error && <InlineError message={error} action={isZh ? '刷新' : 'Refresh'} onAction={onRetry} />}
            {locked && (
                <div className="cart-pending-actions">
                    <InlineError
                        message={
                            isZh
                                ? '订单正在等待支付，购物车内容已锁定。可以继续支付，或返回修改商品与优惠。'
                                : 'This cart is locked while its order awaits payment. Continue payment or reopen it to make changes.'
                        }
                        action={isZh ? '继续支付' : 'Continue payment'}
                        onAction={() => navigateTo({ name: 'payment' })}
                    />
                    <button type="button" onClick={onReopen} disabled={loading}>
                        {isZh ? '返回修改订单' : 'Return to edit order'}
                    </button>
                </div>
            )}
            {!customer && !!lines.length && (
                <section className="cart-guest-notice" aria-labelledby="cart-guest-title">
                    <span className="cart-guest-icon">
                        <ShoppingBag />
                    </span>
                    <div className="cart-guest-copy">
                        <strong id="cart-guest-title">
                            {isZh ? '游客购物车已保存' : 'Your guest cart is saved'}
                        </strong>
                        <small>
                            {isZh
                                ? '可以直接结算；登录后可同步购物车、订单和收货地址'
                                : 'Check out now, or sign in to sync your cart, orders and addresses'}
                        </small>
                    </div>
                    <div className="cart-guest-actions">
                        <button type="button" onClick={() => navigateTo({ name: 'login' })}>
                            {isZh ? '登录并同步' : 'Sign in and sync'}
                        </button>
                        <button type="button" onClick={() => navigateTo({ name: 'register' })}>
                            {isZh ? '注册账户' : 'Create account'}
                        </button>
                    </div>
                </section>
            )}
            {loading && !cart ? (
                <ListSkeleton label={isZh ? '正在加载购物车' : 'Loading cart'} />
            ) : !lines.length ? (
                <EmptyState
                    icon={<ShoppingBag />}
                    title={isZh ? '购物车还是空的' : 'Your cart is empty'}
                    detail={isZh ? '去挑几件喜欢的商品吧' : 'Browse the shop to add something'}
                    action={isZh ? '去逛商品' : 'Browse products'}
                    onAction={() => navigateTo({ name: 'category' })}
                />
            ) : (
                <>
                    <div className="cart-groups">
                        {!!physical.length && (
                            <CartGroup
                                title={isZh ? '普通商品' : 'Physical products'}
                                hint={isZh ? '配送方式结算时确认' : 'Delivery confirmed at checkout'}
                                lines={sortPinnedLines(physical)}
                                market={market}
                                locale={locale}
                                language={language}
                                loading={editingBlocked || (loading && !selectionPending) || locked}
                                selectionDisabled={editingBlocked || (loading && !selectionPending) || locked}
                                favoriteProductIds={favoriteProductIds}
                                pinnedLineIds={pinnedLineIds}
                                openActionLineId={openActionLineId}
                                onSelect={onSelect}
                                onSelectAll={onSelectGroup}
                                onQuantity={onQuantity}
                                onRemove={onRemove}
                                onFavorite={toggleFavoriteLine}
                                onPin={togglePinnedLine}
                                onShare={shareCartProduct}
                                onActionOpenChange={lineId => setOpenActionLineId(lineId)}
                            />
                        )}
                        {!!digital.length && (
                            <CartGroup
                                title={isZh ? '数字商品' : 'Digital products'}
                                hint={
                                    isZh
                                        ? '付款后按商品交付方式处理'
                                        : 'Processed by the selected delivery method after payment'
                                }
                                lines={sortPinnedLines(digital)}
                                market={market}
                                locale={locale}
                                language={language}
                                loading={editingBlocked || (loading && !selectionPending) || locked}
                                selectionDisabled={editingBlocked || (loading && !selectionPending) || locked}
                                favoriteProductIds={favoriteProductIds}
                                pinnedLineIds={pinnedLineIds}
                                openActionLineId={openActionLineId}
                                onSelect={onSelect}
                                onSelectAll={onSelectGroup}
                                onQuantity={onQuantity}
                                onRemove={onRemove}
                                onFavorite={toggleFavoriteLine}
                                onPin={togglePinnedLine}
                                onShare={shareCartProduct}
                                onActionOpenChange={lineId => setOpenActionLineId(lineId)}
                            />
                        )}
                    </div>
                    <button
                        className="coupon-row"
                        type="button"
                        onClick={() => setCouponOpen(true)}
                        disabled={!order || loading || locked}
                    >
                        <span>
                            <TicketPercent />
                            <strong>{isZh ? '优惠信息' : 'Offers'}</strong>
                        </span>
                        <span>
                            <small title={selectedCouponLabel ?? undefined}>
                                {selectedCouponLabel ??
                                    (isZh ? '选择已领取优惠券' : 'Choose a claimed coupon')}
                            </small>
                            <ChevronRight />
                        </span>
                    </button>
                    {!!invalidLines.length && (
                        <section className="invalid-cart-lines">
                            <button
                                type="button"
                                onClick={() => setInvalidOpen(open => !open)}
                                aria-expanded={invalidOpen}
                            >
                                <span>
                                    {isZh
                                        ? `失效商品 ${invalidLines.length} 件`
                                        : `${invalidLines.length} unavailable items`}
                                </span>
                                <span>
                                    {invalidOpen ? (isZh ? '收起' : 'Collapse') : isZh ? '展开' : 'Expand'}{' '}
                                    <ChevronRight />
                                </span>
                            </button>
                            {invalidOpen && (
                                <div>
                                    {invalidLines.map(line => (
                                        <article key={line.id}>
                                            <div className="image-placeholder">
                                                <Package />
                                            </div>
                                            <span>
                                                <strong>
                                                    {line.productVariant?.name ??
                                                        (isZh ? '商品已失效' : 'Unavailable item')}
                                                </strong>
                                                <small>
                                                    {isZh
                                                        ? '当前规格暂不可购买'
                                                        : 'This variant cannot be purchased'}
                                                </small>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => onRemove(line.id)}
                                                disabled={loading || locked}
                                            >
                                                {isZh ? '删除' : 'Remove'}
                                            </button>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                    {!locked && (
                        <ProductSection
                            title={isZh ? '顺手带一件' : 'Complete the order'}
                            subtitle={isZh ? '从当前店铺继续挑选' : 'More from this store'}
                            subtitlePlacement="end"
                            products={products
                                .filter(
                                    product =>
                                        !lines.some(
                                            line => line.productVariant?.id === product.variants[0]?.id,
                                        ),
                                )
                                .slice(0, 4)}
                            market={market}
                            locale={locale}
                            language={language}
                            onProduct={product => navigateTo({ name: 'product', id: product.id })}
                        />
                    )}
                </>
            )}

            {isActive && !!lines.length && (
                <div className={`cart-checkout-bar${isCheckoutBarHidden ? ' is-scrolled-hidden' : ''}`}>
                    <div>
                        <span>
                            {isZh ? '合计' : 'Total'}{' '}
                            <strong aria-live="polite" aria-busy={selectionPending || commandUnknown}>
                                {selectionPending || commandUnknown
                                    ? isZh
                                        ? '计算中…'
                                        : 'Updating…'
                                    : formatMoney(amount, order?.currencyCode ?? market.currencyCode, locale)}
                            </strong>
                        </span>
                        <small>
                            {selectionPending || commandUnknown
                                ? isZh
                                    ? '正在更新所选商品和优惠'
                                    : 'Updating selected items and offers'
                                : locked && order
                                  ? digitalOnly
                                      ? isZh
                                          ? '无需配送'
                                          : 'No shipping required'
                                      : order.shippingWithTax > 0
                                        ? isZh
                                            ? `已含配送费 ${formatMoney(order.shippingWithTax, order.currencyCode, locale)}`
                                            : `Includes ${formatMoney(order.shippingWithTax, order.currencyCode, locale)} delivery`
                                        : isZh
                                          ? '配送费已确认'
                                          : 'Delivery confirmed'
                                  : discount
                                    ? isZh
                                        ? `已优惠 ${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)}`
                                        : `${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)} saved`
                                    : digitalOnly
                                      ? isZh
                                          ? '无需配送'
                                          : 'No shipping required'
                                      : isZh
                                        ? '不含待计算运费'
                                        : 'Shipping not included'}
                        </small>
                    </div>
                    <button
                        type="button"
                        onClick={onCheckout}
                        disabled={loading || locked || !cart?.selectedQuantity}
                    >
                        {locked
                            ? isZh
                                ? '订单待支付'
                                : 'Payment pending'
                            : isZh
                              ? `结算（${cart?.selectedQuantity ?? 0}）`
                              : `Checkout (${cart?.selectedQuantity ?? 0})`}
                    </button>
                </div>
            )}
            {couponOpen && order && (
                <CouponSheet
                    coupons={coupons}
                    orderId={order.id}
                    language={language}
                    loading={loading}
                    onApply={onApplyCoupon}
                    onRemove={onRemoveCoupon}
                    onBrowseCoupons={() => {
                        setCouponOpen(false);
                        navigateTo({ name: 'coupons' });
                    }}
                    onClose={() => setCouponOpen(false)}
                />
            )}
        </main>
    );
}
