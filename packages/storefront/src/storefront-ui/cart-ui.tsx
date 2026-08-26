import {
    Check,
    ChevronLeft,
    Heart,
    Minus,
    Package,
    Pin,
    Plus,
    Share2,
    TicketPercent,
    Trash2,
} from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

import { MarketConfig, StoreCustomerCoupon, StorefrontCart, StorefrontLanguage } from '../types';

import { Sheet } from './page-shell';
import { formatMoney, ProductVariantImage } from './product-display';

export function CartGroup({
    title,
    hint,
    lines,
    market,
    locale,
    language,
    loading,
    favoriteProductIds,
    pinnedLineIds,
    openActionLineId,
    onSelect,
    onSelectAll,
    onQuantity,
    onRemove,
    onFavorite,
    onPin,
    onShare,
    onActionOpenChange,
}: {
    title: string;
    hint: string;
    lines: StorefrontCart['lines'];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    loading: boolean;
    favoriteProductIds: string[];
    pinnedLineIds: string[];
    openActionLineId: string | null;
    onSelect: (lineId: string, selected: boolean) => void;
    onSelectAll: (lineIds: string[], selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
    onFavorite: (productId: string, productName: string) => void;
    onPin: (lineId: string, productName: string) => void;
    onShare: (productId: string, productName: string) => Promise<void>;
    onActionOpenChange: (lineId: string | null) => void;
}) {
    const allSelected = lines.every(line => line.selected);
    const partiallySelected = !allSelected && lines.some(line => line.selected);
    return (
        <section className="cart-group">
            <header>
                <button
                    type="button"
                    className={`group-select ${partiallySelected ? 'is-partial' : ''}`}
                    onClick={() =>
                        onSelectAll(
                            lines.map(line => line.id),
                            !allSelected,
                        )
                    }
                    disabled={loading}
                >
                    <span>{allSelected ? <Check /> : partiallySelected ? <Minus /> : null}</span>
                    <strong>{title}</strong>
                </button>
                <span>{hint}</span>
            </header>
            {lines.map(line => (
                <SwipeableCartLine
                    key={line.id}
                    line={line}
                    market={market}
                    locale={locale}
                    language={language}
                    loading={loading}
                    open={openActionLineId === line.id}
                    favorite={
                        !!line.productVariant?.product.id &&
                        favoriteProductIds.includes(line.productVariant.product.id)
                    }
                    pinned={pinnedLineIds.includes(line.id)}
                    onSelect={onSelect}
                    onQuantity={onQuantity}
                    onRemove={onRemove}
                    onFavorite={onFavorite}
                    onPin={onPin}
                    onShare={onShare}
                    onActionOpenChange={onActionOpenChange}
                />
            ))}
        </section>
    );
}

export const CART_SWIPE_FALLBACK_WIDTH = 240;

export const CART_SWIPE_THRESHOLD = 48;

export function SwipeableCartLine({
    line,
    market,
    locale,
    language,
    loading,
    open,
    favorite,
    pinned,
    onSelect,
    onQuantity,
    onRemove,
    onFavorite,
    onPin,
    onShare,
    onActionOpenChange,
}: {
    line: StorefrontCart['lines'][number];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    loading: boolean;
    open: boolean;
    favorite: boolean;
    pinned: boolean;
    onSelect: (lineId: string, selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
    onFavorite: (productId: string, productName: string) => void;
    onPin: (lineId: string, productName: string) => void;
    onShare: (productId: string, productName: string) => Promise<void>;
    onActionOpenChange: (lineId: string | null) => void;
}) {
    const isZh = language === 'zh';
    const variant = line.productVariant;
    const productId = variant?.product.id;
    const productName = variant?.name ?? (isZh ? '商品' : 'item');
    const frontRef = useRef<HTMLDivElement>(null);
    const actionsRef = useRef<HTMLDivElement>(null);
    const gestureRef = useRef({
        active: false,
        horizontal: false,
        startX: 0,
        startY: 0,
        startOffset: 0,
        suppressClick: false,
    });

    useEffect(() => {
        const front = frontRef.current;
        if (!front) return;
        front.classList.remove('is-dragging');
        front.style.transform = '';
    }, [open]);

    const actionWidth = () => actionsRef.current?.offsetWidth ?? CART_SWIPE_FALLBACK_WIDTH;

    const beginSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (
            loading ||
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest('button, input, label'))
        ) {
            return;
        }
        const front = event.currentTarget;
        const width = actionWidth();
        gestureRef.current = {
            active: true,
            horizontal: false,
            startX: event.clientX,
            startY: event.clientY,
            startOffset: open ? -width : 0,
            suppressClick: false,
        };
        front.setPointerCapture(event.pointerId);
        front.classList.add('is-dragging');
    };

    const moveSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture.active) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.horizontal) {
            if (Math.abs(deltaY) > Math.abs(deltaX) + 6) {
                gesture.active = false;
                event.currentTarget.classList.remove('is-dragging');
                event.currentTarget.style.transform = '';
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (Math.abs(deltaX) < 6) return;
            gesture.horizontal = true;
        }
        event.preventDefault();
        const nextOffset = Math.max(-actionWidth(), Math.min(0, gesture.startOffset + deltaX));
        event.currentTarget.style.transform = `translate3d(${nextOffset}px, 0, 0)`;
    };

    const finishSwipe = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
        const gesture = gestureRef.current;
        if (!gesture.active && !gesture.horizontal) return;
        const deltaX = event.clientX - gesture.startX;
        let shouldOpen = open;
        if (!cancelled && gesture.horizontal) {
            if (deltaX <= -CART_SWIPE_THRESHOLD) shouldOpen = true;
            if (deltaX >= CART_SWIPE_THRESHOLD) shouldOpen = false;
            gesture.suppressClick = true;
        }
        gesture.active = false;
        gesture.horizontal = false;
        const front = event.currentTarget;
        front.classList.remove('is-dragging');
        front.style.transform = `translate3d(${shouldOpen ? -actionWidth() : 0}px, 0, 0)`;
        if (front.hasPointerCapture(event.pointerId)) front.releasePointerCapture(event.pointerId);
        onActionOpenChange(shouldOpen ? line.id : null);
        requestAnimationFrame(() => {
            front.style.transform = '';
        });
    };

    const closeAfterAction = () => onActionOpenChange(null);

    return (
        <article
            className={`cart-line-swipe${open ? ' is-open' : ''}`}
            data-swipe-open={open ? 'true' : 'false'}
            onKeyDown={event => {
                if (event.key === 'Escape') closeAfterAction();
            }}
        >
            <div
                className="cart-line-swipe-actions"
                ref={actionsRef}
                aria-label={isZh ? `${productName} 商品操作` : `${productName} actions`}
            >
                <button
                    className={favorite ? 'is-active' : ''}
                    type="button"
                    data-cart-action="favorite"
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? isZh
                                ? `取消收藏 ${productName}`
                                : `Remove ${productName} from favorites`
                            : isZh
                              ? `收藏 ${productName}`
                              : `Save ${productName}`
                    }
                    disabled={loading || !productId}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => productId && onFavorite(productId, productName)}
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                    <span>{favorite ? (isZh ? '已收藏' : 'Saved') : isZh ? '收藏' : 'Save'}</span>
                </button>
                <button
                    type="button"
                    data-cart-action="share"
                    aria-label={isZh ? `分享 ${productName}` : `Share ${productName}`}
                    disabled={loading || !productId}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => {
                        if (!productId) return;
                        closeAfterAction();
                        void onShare(productId, productName);
                    }}
                >
                    <Share2 aria-hidden="true" />
                    <span>{isZh ? '分享' : 'Share'}</span>
                </button>
                <button
                    className={pinned ? 'is-active' : ''}
                    type="button"
                    data-cart-action="pin"
                    aria-pressed={pinned}
                    aria-label={
                        pinned
                            ? isZh
                                ? `取消置顶 ${productName}`
                                : `Unpin ${productName}`
                            : isZh
                              ? `置顶 ${productName}`
                              : `Pin ${productName}`
                    }
                    disabled={loading}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => onPin(line.id, productName)}
                >
                    <Pin fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" />
                    <span>{pinned ? (isZh ? '已置顶' : 'Pinned') : isZh ? '置顶' : 'Pin'}</span>
                </button>
                <button
                    className="cart-line-delete-action"
                    type="button"
                    data-cart-action="remove"
                    aria-label={isZh ? `删除 ${productName}` : `Remove ${productName}`}
                    disabled={loading}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => onRemove(line.id)}
                >
                    <Trash2 aria-hidden="true" />
                    <span>{isZh ? '删除' : 'Remove'}</span>
                </button>
            </div>

            <div
                ref={frontRef}
                className={`cart-line ${line.selected ? '' : 'is-unselected'}`}
                onPointerDown={beginSwipe}
                onPointerMove={moveSwipe}
                onPointerUp={event => finishSwipe(event)}
                onPointerCancel={event => finishSwipe(event, true)}
                onClick={event => {
                    if (gestureRef.current.suppressClick) {
                        gestureRef.current.suppressClick = false;
                        return;
                    }
                    if (
                        open &&
                        !(event.target instanceof Element && event.target.closest('button, input, label'))
                    ) {
                        closeAfterAction();
                    }
                }}
            >
                <label className="round-check">
                    <input
                        type="checkbox"
                        aria-label={isZh ? `选择 ${productName}` : `Select ${productName}`}
                        checked={line.selected}
                        disabled={!line.available || loading}
                        onChange={event => onSelect(line.id, event.target.checked)}
                    />
                    <span>
                        <Check />
                    </span>
                </label>
                <div className="cart-line-image">
                    {variant ? (
                        <ProductVariantImage variant={variant} alt={variant.name} />
                    ) : (
                        <div className="image-placeholder">
                            <Package />
                        </div>
                    )}
                </div>
                <div className="cart-line-copy">
                    <button
                        className="cart-line-swipe-toggle"
                        type="button"
                        aria-expanded={open}
                        aria-label={
                            open
                                ? isZh
                                    ? `收起 ${productName} 的商品操作`
                                    : `Close ${productName} actions`
                                : isZh
                                  ? `展开 ${productName} 的商品操作`
                                  : `Open ${productName} actions`
                        }
                        onClick={() => onActionOpenChange(open ? null : line.id)}
                    >
                        <ChevronLeft aria-hidden="true" />
                    </button>
                    <strong>{variant?.name ?? (isZh ? '商品已失效' : 'Unavailable item')}</strong>
                    <small>{variant?.sku}</small>
                    <div className="cart-line-purchase-row">
                        <b>
                            {variant
                                ? formatMoney(variant.priceWithTax, variant.currencyCode, locale)
                                : formatMoney(0, market.currencyCode, locale)}
                        </b>
                        <div className="cart-line-actions">
                            <div>
                                <button
                                    type="button"
                                    aria-label={
                                        line.quantity === 1
                                            ? isZh
                                                ? `减少 ${productName} 数量并删除商品`
                                                : `Decrease ${productName} quantity and remove item`
                                            : isZh
                                              ? `减少 ${productName} 数量`
                                              : `Decrease ${productName} quantity`
                                    }
                                    onClick={() =>
                                        line.quantity === 1
                                            ? onRemove(line.id)
                                            : onQuantity(line.id, line.quantity - 1)
                                    }
                                    disabled={loading}
                                >
                                    <Minus />
                                </button>
                                <span>{line.quantity}</span>
                                <button
                                    type="button"
                                    aria-label={
                                        isZh ? `增加 ${productName} 数量` : `Increase ${productName} quantity`
                                    }
                                    onClick={() => onQuantity(line.id, line.quantity + 1)}
                                    disabled={loading || !line.available}
                                >
                                    <Plus />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    );
}

export function CouponSheet({
    coupons,
    orderId,
    language,
    loading,
    onApply,
    onRemove,
    onClose,
}: {
    coupons: StoreCustomerCoupon[];
    orderId: string;
    language: StorefrontLanguage;
    loading: boolean;
    onApply: (customerCouponId: string) => Promise<string | null>;
    onRemove: (customerCouponId: string) => Promise<string | null>;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const choose = async (coupon: StoreCustomerCoupon) => {
        setSubmitting(true);
        setError('');
        const applied = coupon.lockedOrderId === orderId;
        const nextError = await (applied ? onRemove(coupon.id) : onApply(coupon.id));
        setSubmitting(false);
        if (nextError) setError(nextError);
    };
    const selectableCoupons = coupons.filter(coupon => coupon.usable || coupon.lockedOrderId === orderId);
    return (
        <Sheet title={isZh ? '选择优惠券' : 'Choose a coupon'} language={language} onClose={onClose}>
            <div className="coupon-sheet-content">
                {selectableCoupons.length ? (
                    <section className="applied-coupons">
                        <strong>{isZh ? '我的可用优惠券' : 'My available coupons'}</strong>
                        {selectableCoupons.map(coupon => {
                            const applied = coupon.lockedOrderId === orderId;
                            return (
                                <div key={coupon.id}>
                                    <span>
                                        <TicketPercent />
                                        {coupon.campaignName}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void choose(coupon)}
                                        disabled={loading || submitting}
                                    >
                                        {applied ? (isZh ? '取消使用' : 'Unapply') : isZh ? '使用' : 'Apply'}
                                    </button>
                                </div>
                            );
                        })}
                    </section>
                ) : (
                    <p>{isZh ? '暂无可用优惠券，请先到领券中心领取' : 'No coupons available yet.'}</p>
                )}
                {error && <small className="form-error">{error}</small>}
            </div>
        </Sheet>
    );
}
