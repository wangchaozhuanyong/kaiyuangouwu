import { StoreCustomerCoupon, StorefrontCart } from '../types';

export interface AutomaticCouponSelection {
    scope: string;
    couponId: string | null;
    attemptKey: string;
}

export function readAutomaticCouponSelection(marketCode: string): AutomaticCouponSelection | null {
    try {
        const value: unknown = JSON.parse(
            sessionStorage.getItem(`storefront:coupon-auto-selection:${marketCode}`) ?? 'null',
        );
        if (
            value &&
            typeof value === 'object' &&
            'scope' in value &&
            typeof value.scope === 'string' &&
            'couponId' in value &&
            (value.couponId === null || typeof value.couponId === 'string') &&
            'attemptKey' in value &&
            typeof value.attemptKey === 'string'
        ) {
            return { scope: value.scope, couponId: value.couponId, attemptKey: value.attemptKey };
        }
    } catch {
        // Use the hook's in-memory selection when storage is unavailable or malformed.
    }
    return null;
}

export function rememberAutomaticCouponSelection(
    marketCode: string,
    selection: AutomaticCouponSelection,
): void {
    try {
        sessionStorage.setItem(`storefront:coupon-auto-selection:${marketCode}`, JSON.stringify(selection));
    } catch {
        // The hook also retains the selection in memory.
    }
}

export function automaticCouponInputKey(cart: StorefrontCart | null, coupons: StoreCustomerCoupon[]): string {
    const order = cart?.checkoutOrder;
    if (!order) return '';
    // BEST itself increments cart.revision and changes discount totals and lock status.
    // Only merchandise and coupon terms may trigger another comparison.
    const lines = cart?.lines ? cart.lines.filter(line => line.selected && line.available) : order.lines;
    return JSON.stringify({
        currency: order.currencyCode,
        lines: lines
            .map(line => [
                line.productVariant?.id,
                line.quantity,
                line.productVariant?.priceWithTax,
                line.productVariant?.currencyCode,
                line.productVariant?.storeCouponCollectionIds?.slice().sort(),
            ])
            .sort(),
        coupons: coupons
            .filter(
                coupon =>
                    ['AVAILABLE', 'RETURNED'].includes(coupon.status) ||
                    (coupon.status === 'LOCKED' && coupon.lockedOrderId === order.id),
            )
            .map(coupon => [
                coupon.id,
                coupon.usable || (coupon.status === 'LOCKED' && coupon.lockedOrderId === order.id),
                coupon.campaignKind,
                coupon.minimumSpend,
                coupon.currencyCode,
                coupon.discountAmount,
                coupon.discountRate,
                coupon.validFrom,
                coupon.validUntil,
                coupon.collectionIds?.slice().sort(),
                coupon.productVariantIds?.slice().sort(),
            ])
            .sort(),
    });
}
