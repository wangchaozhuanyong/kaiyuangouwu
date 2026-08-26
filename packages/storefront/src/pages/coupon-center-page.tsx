import { useNavigate, useRouter } from '@tanstack/react-router';
import { ChevronRight, TicketPercent } from 'lucide-react';
import { useState } from 'react';
import type { RouteState } from '../storefront-router';

import {
    CouponCenterTab,
    couponCampaignsForTab,
    couponCenterTabCount,
    customerCouponsForTab,
    isLockedCoupon,
} from '../coupon-center-state';
import { couponCardsFromCampaigns } from '../storefront-coupons';
import { routeNavigateOptions } from '../storefront-router';
import { customerCouponStatusLabel } from '../storefront-ui/order-ui';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import { StoreCustomerCoupon, StorefrontCouponCampaign, StorefrontLanguage } from '../types';

interface CouponCenterPageProps {
    coupons: StorefrontCouponCampaign[];
    myCoupons: StoreCustomerCoupon[];
    currencyCode: string;
    language: StorefrontLanguage;
    loading: boolean;
    cartHasItems: boolean;
    onClaim: (campaignId: string) => Promise<string | null>;
    onApply: (customerCouponId: string) => Promise<string | null>;
    onRemove: (customerCouponId: string) => Promise<string | null>;
}

const tabs: CouponCenterTab[] = ['ACTIVITIES', 'UNCLAIMED', 'USABLE', 'HISTORY'];

export function CouponCenterPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const { coupons, myCoupons, currencyCode, language, loading, cartHasItems, onClaim, onApply, onRemove } =
        useStorefront<CouponCenterPageProps>();
    const isZh = language === 'zh';
    const [activeTab, setActiveTab] = useState<CouponCenterTab>('ACTIVITIES');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const cards = couponCardsFromCampaigns(coupons, language, currencyCode);
    const campaignIds = new Set(couponCampaignsForTab(coupons, activeTab).map(campaign => campaign.id));
    const visibleCards = cards.filter(card => campaignIds.has(card.campaignId));
    const visibleCustomerCoupons = customerCouponsForTab(myCoupons, activeTab);

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

    const shopNow = () => navigateTo({ name: 'category' });

    return (
        <Subpage title={isZh ? '优惠券中心' : 'Coupon center'} language={language} onBack={goBack}>
            <nav className="coupon-center-tabs" aria-label={isZh ? '优惠券分类' : 'Coupon categories'}>
                {tabs.map(tab => (
                    <button
                        key={tab}
                        type="button"
                        className={activeTab === tab ? 'is-active' : ''}
                        aria-current={activeTab === tab ? 'page' : undefined}
                        onClick={() => setActiveTab(tab)}
                    >
                        <span>{tabLabel(tab, language)}</span>
                        <small>{couponCenterTabCount(tab, coupons, myCoupons)}</small>
                    </button>
                ))}
            </nav>

            {activeTab === 'ACTIVITIES' || activeTab === 'UNCLAIMED' ? (
                visibleCards.length ? (
                    <section
                        className="coupon-center-available"
                        aria-label={
                            activeTab === 'UNCLAIMED'
                                ? isZh
                                    ? '未领取优惠券'
                                    : 'Unclaimed coupons'
                                : isZh
                                  ? '当前优惠活动'
                                  : 'Current coupon activities'
                        }
                    >
                        <header>
                            <strong>
                                {activeTab === 'UNCLAIMED'
                                    ? isZh
                                        ? '待领取'
                                        : 'Ready to claim'
                                    : isZh
                                      ? '当前优惠券活动'
                                      : 'Current coupon activities'}
                            </strong>
                            <small>
                                {isZh
                                    ? '领取后进入“可使用”，加入商品后可直接使用'
                                    : 'Claimed coupons move to Usable and can be applied when the cart has items'}
                            </small>
                        </header>
                        <div>
                            {visibleCards.map(card => {
                                const campaign = coupons.find(item => item.id === card.campaignId);
                                const owned = myCoupons.filter(item => item.campaignId === card.campaignId);
                                const lockedCoupon = owned.find(isLockedCoupon);
                                const usableCoupon = owned.find(
                                    item => item.usable || ['AVAILABLE', 'RETURNED'].includes(item.status),
                                );
                                const action = lockedCoupon
                                    ? 'REMOVE'
                                    : usableCoupon && cartHasItems
                                      ? 'APPLY'
                                      : campaign?.claimable
                                        ? 'CLAIM'
                                        : usableCoupon
                                          ? 'SHOP'
                                          : null;
                                const actionId =
                                    action === 'CLAIM'
                                        ? card.campaignId
                                        : ((lockedCoupon ?? usableCoupon)?.id ?? '');
                                return (
                                    <button
                                        type="button"
                                        key={card.id}
                                        disabled={loading || submitting || !action}
                                        onClick={() => {
                                            if (action === 'SHOP') shopNow();
                                            else if (action) void runCouponAction(action, actionId);
                                        }}
                                    >
                                        <span>
                                            <b>
                                                {card.unitBefore ? card.unit : ''}
                                                {card.value}
                                                {!card.unitBefore ? card.unit : ''}
                                            </b>
                                            <small>{card.description}</small>
                                        </span>
                                        <em>{campaignActionLabel(action, owned.length > 0, language)}</em>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ) : (
                    <CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />
                )
            ) : visibleCustomerCoupons.length ? (
                <section className="coupon-center" aria-busy={loading || submitting}>
                    <div className="coupon-center-intro">
                        <TicketPercent aria-hidden="true" />
                        <span>
                            <strong>
                                {activeTab === 'USABLE'
                                    ? isZh
                                        ? '可使用优惠券'
                                        : 'Usable coupons'
                                    : isZh
                                      ? '已使用与已失效'
                                      : 'Used and inactive'}
                            </strong>
                            <small>
                                {activeTab === 'USABLE'
                                    ? isZh
                                        ? '包含待使用、已返还和购物车已锁定的优惠券'
                                        : 'Available, returned and cart-locked coupons'
                                    : isZh
                                      ? '保留已核销、已过期和已撤销记录'
                                      : 'Used, expired and revoked coupon records'}
                            </small>
                        </span>
                    </div>
                    <section className="applied-coupons coupon-center-applied">
                        {visibleCustomerCoupons.map(coupon => {
                            const locked = isLockedCoupon(coupon);
                            const canApply = !locked && coupon.usable && cartHasItems;
                            const canShop = !locked && coupon.usable && !cartHasItems;
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
                                    {locked || canApply || canShop ? (
                                        <button
                                            type="button"
                                            disabled={loading || submitting}
                                            onClick={() => {
                                                if (canShop) shopNow();
                                                else
                                                    void runCouponAction(
                                                        locked ? 'REMOVE' : 'APPLY',
                                                        coupon.id,
                                                    );
                                            }}
                                        >
                                            {locked
                                                ? isZh
                                                    ? '移除'
                                                    : 'Remove'
                                                : canShop
                                                  ? isZh
                                                      ? '去使用'
                                                      : 'Shop now'
                                                  : isZh
                                                    ? '使用'
                                                    : 'Apply'}
                                        </button>
                                    ) : null}
                                </div>
                            );
                        })}
                    </section>
                </section>
            ) : (
                <CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />
            )}

            {error ? (
                <small className="form-error coupon-center-error" role="alert">
                    {error}
                </small>
            ) : null}
            <button
                className="coupon-center-cart-link coupon-center-cart-link-standalone"
                type="button"
                onClick={() => navigateTo({ name: 'cart' })}
            >
                {isZh ? '查看购物车和优惠明细' : 'View cart and discount details'}
                <ChevronRight aria-hidden="true" />
            </button>
        </Subpage>
    );
}

function CouponTabEmpty({
    tab,
    language,
    onShop,
}: {
    tab: CouponCenterTab;
    language: StorefrontLanguage;
    onShop: () => void;
}) {
    const isZh = language === 'zh';
    const isHistory = tab === 'HISTORY';
    return (
        <EmptyState
            icon={<TicketPercent />}
            title={
                isHistory
                    ? isZh
                        ? '暂无使用或失效记录'
                        : 'No coupon history'
                    : isZh
                      ? '该分类暂无优惠券'
                      : 'No coupons in this category'
            }
            detail={
                isHistory
                    ? isZh
                        ? '优惠券核销、过期或撤销后会保留在这里'
                        : 'Used, expired or revoked coupons will stay here'
                    : isZh
                      ? '可以继续选购商品，留意下一次优惠活动'
                      : 'Keep shopping and check back for the next offer'
            }
            action={isHistory ? undefined : isZh ? '去选购' : 'Shop now'}
            onAction={isHistory ? undefined : onShop}
        />
    );
}

function tabLabel(tab: CouponCenterTab, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    return {
        ACTIVITIES: isZh ? '当前活动' : 'Activities',
        UNCLAIMED: isZh ? '未领取' : 'Unclaimed',
        USABLE: isZh ? '可使用' : 'Usable',
        HISTORY: isZh ? '记录' : 'History',
    }[tab];
}

function campaignActionLabel(
    action: 'CLAIM' | 'APPLY' | 'REMOVE' | 'SHOP' | null,
    owned: boolean,
    language: StorefrontLanguage,
): string {
    const isZh = language === 'zh';
    if (action === 'REMOVE') return isZh ? '移除' : 'Remove';
    if (action === 'APPLY') return isZh ? '使用' : 'Apply';
    if (action === 'SHOP') return isZh ? '去使用' : 'Shop now';
    if (action === 'CLAIM') {
        return owned ? (isZh ? '再领一张' : 'Claim another') : isZh ? '领取' : 'Claim';
    }
    return isZh ? (owned ? '已领取' : '已结束') : owned ? 'Claimed' : 'Ended';
}
