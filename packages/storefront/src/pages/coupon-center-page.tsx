import { useNavigate, useRouter } from '@tanstack/react-router';
import { ChevronRight, TicketPercent } from 'lucide-react';
import { useState } from 'react';
import type { RouteState } from '../storefront-router';

import { couponCardsFromCampaigns } from '../storefront-coupons';
import { routeNavigateOptions } from '../storefront-router';
import { customerCouponStatusLabel } from '../storefront-ui/order-ui';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import { Order, StoreCustomerCoupon, StorefrontCouponCampaign, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

interface CouponCenterPageProps {
    order: Order | null;
    coupons: StorefrontCouponCampaign[];
    myCoupons: StoreCustomerCoupon[];
    currencyCode: string;
    language: StorefrontLanguage;
    loading: boolean;
    onClaim: (campaignId: string) => Promise<string | null>;
    onApply: (customerCouponId: string) => Promise<string | null>;
    onRemove: (customerCouponId: string) => Promise<string | null>;
}

export function CouponCenterPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const { order, coupons, myCoupons, currencyCode, language, loading, onClaim, onApply, onRemove } =
        useStorefront<CouponCenterPageProps>();
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const availableCoupons = couponCardsFromCampaigns(coupons, language, currencyCode);
    const runCouponAction = async (action: 'CLAIM' | 'APPLY' | 'REMOVE', id: string) => {
        if (submitting) return;
        setSubmitting(true);
        setError('');
        const nextError = await (action === 'CLAIM'
            ? onClaim(id)
            : action === 'APPLY'
              ? onApply(id)
              : onRemove(id));
        setSubmitting(false);
        if (nextError) setError(nextError);
    };
    return (
        <Subpage title={isZh ? '优惠券' : 'Coupons'} language={language} onBack={goBack}>
            {availableCoupons.length ? (
                <section
                    className="coupon-center-available"
                    aria-label={isZh ? '可领优惠券' : 'Available coupons'}
                >
                    <header>
                        <strong>{isZh ? '当前可用优惠' : 'Available offers'}</strong>
                        <small>
                            {isZh
                                ? '点击领取，购物车有商品时会自动使用'
                                : 'Claim now and apply automatically when the cart has items'}
                        </small>
                    </header>
                    <div>
                        {availableCoupons.map(couponCard => {
                            const campaign = coupons.find(item => item.id === couponCard.campaignId);
                            const owned = myCoupons.filter(item => item.campaignId === couponCard.campaignId);
                            const appliedCoupon = owned.find(item => item.lockedOrderId === order?.id);
                            const usableCoupon = owned.find(item => item.usable);
                            const canClaim = campaign?.claimable ?? false;
                            const action = appliedCoupon
                                ? 'REMOVE'
                                : usableCoupon && order
                                  ? 'APPLY'
                                  : canClaim
                                    ? 'CLAIM'
                                    : null;
                            const actionId =
                                action === 'CLAIM'
                                    ? couponCard.campaignId
                                    : ((appliedCoupon ?? usableCoupon)?.id ?? '');
                            return (
                                <button
                                    type="button"
                                    key={couponCard.id}
                                    disabled={loading || submitting || !action}
                                    onClick={() => action && void runCouponAction(action, actionId)}
                                >
                                    <span>
                                        <b>
                                            {couponCard.unitBefore ? couponCard.unit : ''}
                                            {couponCard.value}
                                            {!couponCard.unitBefore ? couponCard.unit : ''}
                                        </b>
                                        <small>{couponCard.description}</small>
                                    </span>
                                    <em>
                                        {appliedCoupon
                                            ? isZh
                                                ? '移除'
                                                : 'Remove'
                                            : usableCoupon && order
                                              ? isZh
                                                  ? '使用'
                                                  : 'Apply'
                                              : canClaim
                                                ? isZh
                                                    ? owned.length
                                                        ? '再领一张'
                                                        : '领取'
                                                    : owned.length
                                                      ? 'Claim another'
                                                      : 'Claim'
                                                : isZh
                                                  ? '已领取'
                                                  : 'Claimed'}
                                    </em>
                                </button>
                            );
                        })}
                    </div>
                </section>
            ) : null}
            {!order && !myCoupons.length ? (
                <EmptyState
                    icon={<TicketPercent />}
                    title={isZh ? '还没有可使用优惠券的订单' : 'No active order for coupons'}
                    detail={
                        isZh
                            ? '可以先领取上方优惠券，加入商品后系统会自动使用'
                            : 'Claim an offer above now and it will be applied after you add an item'
                    }
                    action={isZh ? '去选购' : 'Shop now'}
                    onAction={() => navigateTo({ name: 'category' })}
                />
            ) : myCoupons.length ? (
                <section className="coupon-center" aria-busy={loading || submitting}>
                    <div className="coupon-center-intro">
                        <TicketPercent aria-hidden="true" />
                        <span>
                            <strong>{isZh ? '我的优惠券' : 'My coupons'}</strong>
                            <small>
                                {isZh
                                    ? '优惠券状态与有效期由服务器实时管理'
                                    : 'Coupon status and validity are managed by the server'}
                            </small>
                        </span>
                    </div>
                    <section className="applied-coupons coupon-center-applied">
                        <strong>{isZh ? '领取与使用记录' : 'Claim and usage history'}</strong>
                        {myCoupons.map(coupon => {
                            const applied = coupon.lockedOrderId === order?.id;
                            return (
                                <div key={coupon.id}>
                                    <span>
                                        <TicketPercent aria-hidden="true" />
                                        {coupon.campaignName} ·{' '}
                                        {customerCouponStatusLabel(coupon.status, language)}
                                        {coupon.validUntil
                                            ? ` · ${isZh ? '有效至' : 'Valid until'} ${new Intl.DateTimeFormat(
                                                  isZh ? 'zh-CN' : 'en-US',
                                                  { dateStyle: 'medium' },
                                              ).format(new Date(coupon.validUntil))}`
                                            : ''}
                                    </span>
                                    {(applied || (coupon.usable && order)) && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                void runCouponAction(applied ? 'REMOVE' : 'APPLY', coupon.id)
                                            }
                                            disabled={loading || submitting}
                                        >
                                            {applied ? (isZh ? '移除' : 'Remove') : isZh ? '使用' : 'Apply'}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </section>
                    {error && (
                        <small className="form-error" role="alert">
                            {error}
                        </small>
                    )}
                    <button
                        className="coupon-center-cart-link"
                        type="button"
                        onClick={() => navigateTo({ name: 'cart' })}
                    >
                        {isZh ? '查看购物车和优惠明细' : 'View cart and discount details'}
                        <ChevronRight aria-hidden="true" />
                    </button>
                </section>
            ) : null}
        </Subpage>
    );
}
