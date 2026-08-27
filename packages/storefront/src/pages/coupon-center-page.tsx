import { useNavigate, useRouter } from '@tanstack/react-router';
import { CalendarDays, Check, ChevronRight, MapPin, TicketPercent } from 'lucide-react';
import { ReactNode, useState } from 'react';

import {
    CouponCenterTab,
    couponCampaignsForTab,
    couponCenterTabCount,
    customerCouponsForTab,
    isLockedCoupon,
} from '../coupon-center-state';
import {
    StorefrontCouponCard,
    couponCardFromCustomerCoupon,
    couponCardFromUsageRecord,
    couponCardsFromCampaigns,
    couponScopeLabel,
} from '../storefront-coupons';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import {
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontCouponCampaign,
    StorefrontLanguage,
} from '../types';

interface CouponCenterPageProps {
    coupons: StorefrontCouponCampaign[];
    myCoupons: StoreCustomerCoupon[];
    usageRecords: StoreCouponUsageRecord[];
    currencyCode: string;
    language: StorefrontLanguage;
    loading: boolean;
    onClaim: (campaignId: string) => Promise<string | null>;
}

const tabs: CouponCenterTab[] = ['ACTIVITIES', 'UNCLAIMED', 'UNUSED', 'HISTORY'];

export function CouponCenterPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const { coupons, myCoupons, usageRecords, currencyCode, language, loading, onClaim } =
        useStorefront<CouponCenterPageProps>();
    const isZh = language === 'zh';
    const [activeTab, setActiveTab] = useState<CouponCenterTab>('ACTIVITIES');
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const claimedCampaignIds = new Set(myCoupons.map(coupon => coupon.campaignId));
    const customerAwareCampaigns = coupons.map(campaign =>
        claimedCampaignIds.has(campaign.id) ? { ...campaign, claimed: true, claimable: false } : campaign,
    );
    const campaignCards = couponCardsFromCampaigns(customerAwareCampaigns, language, currencyCode);
    const campaignIds = new Set(
        couponCampaignsForTab(customerAwareCampaigns, activeTab).map(campaign => campaign.id),
    );
    const visibleCampaignCards = campaignCards.filter(card => campaignIds.has(card.campaignId));
    const visibleCustomerCoupons = customerCouponsForTab(myCoupons, activeTab);

    const claim = async (campaignId: string) => {
        if (claimingId) return;
        setClaimingId(campaignId);
        setError('');
        const nextError = await onClaim(campaignId);
        setClaimingId(null);
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
                        <small>
                            {couponCenterTabCount(tab, customerAwareCampaigns, myCoupons, usageRecords)}
                        </small>
                    </button>
                ))}
            </nav>

            {activeTab === 'ACTIVITIES' || activeTab === 'UNCLAIMED' ? (
                visibleCampaignCards.length ? (
                    <section
                        className="coupon-center-panel"
                        aria-label={
                            activeTab === 'UNCLAIMED'
                                ? isZh
                                    ? '未领取优惠券'
                                    : 'Unclaimed coupons'
                                : isZh
                                  ? '当前优惠券活动'
                                  : 'Current coupon activities'
                        }
                    >
                        <header className="coupon-center-panel-title">
                            <TicketPercent aria-hidden="true" />
                            <strong>
                                {activeTab === 'UNCLAIMED'
                                    ? isZh
                                        ? '未领取优惠券'
                                        : 'Unclaimed coupons'
                                    : isZh
                                      ? '当前优惠券活动'
                                      : 'Current coupon activities'}
                            </strong>
                        </header>
                        <div className="coupon-center-ticket-list">
                            {visibleCampaignCards.map(card => {
                                const campaign = customerAwareCampaigns.find(
                                    item => item.id === card.campaignId,
                                );
                                if (!campaign) return null;
                                const canClaim = !campaign.claimed && campaign.claimable;
                                const actionLabel = campaign.claimed
                                    ? isZh
                                        ? '已领取'
                                        : 'Claimed'
                                    : campaign.claimable
                                      ? isZh
                                          ? '立即领取'
                                          : 'Claim'
                                      : isZh
                                        ? '已领完'
                                        : 'Unavailable';
                                return (
                                    <CouponTicket
                                        key={card.id}
                                        card={card}
                                        muted={!canClaim}
                                        action={
                                            <button
                                                type="button"
                                                className={`coupon-claim-btn${canClaim ? '' : ' is-claimed'}`}
                                                disabled={!canClaim || loading || claimingId !== null}
                                                onClick={() => void claim(campaign.id)}
                                            >
                                                <span className="coupon-btn-text-wrap">
                                                    {campaign.claimed ? (
                                                        <Check size={12} aria-hidden="true" />
                                                    ) : null}
                                                    <span>{actionLabel}</span>
                                                </span>
                                            </button>
                                        }
                                        details={
                                            activeTab === 'ACTIVITIES' ? (
                                                <CampaignInstructions
                                                    campaign={campaign}
                                                    language={language}
                                                />
                                            ) : undefined
                                        }
                                    />
                                );
                            })}
                        </div>
                    </section>
                ) : (
                    <CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />
                )
            ) : activeTab === 'UNUSED' && visibleCustomerCoupons.length ? (
                <section className="coupon-center-panel" aria-busy={loading}>
                    <div className="coupon-center-ticket-list">
                        {visibleCustomerCoupons.map((coupon, index) => {
                            const card = couponCardFromCustomerCoupon(coupon, language, currencyCode, index);
                            const locked = isLockedCoupon(coupon);
                            return (
                                <CouponTicket
                                    key={coupon.id}
                                    card={card}
                                    action={
                                        locked ? (
                                            <span className="coupon-ticket-status">
                                                {isZh ? '订单占用中' : 'Reserved'}
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                className="coupon-claim-btn"
                                                onClick={shopNow}
                                            >
                                                <span className="coupon-btn-text-wrap">
                                                    <span>{isZh ? '去使用' : 'Shop now'}</span>
                                                </span>
                                            </button>
                                        )
                                    }
                                    meta={customerCouponValidity(coupon, language)}
                                />
                            );
                        })}
                    </div>
                </section>
            ) : activeTab === 'HISTORY' && usageRecords.length ? (
                <section className="coupon-center-panel" aria-busy={loading}>
                    <div className="coupon-center-ticket-list">
                        {usageRecords.map((record, index) => (
                            <CouponTicket
                                key={record.id}
                                card={couponCardFromUsageRecord(record, language, index)}
                                muted
                                action={
                                    <span className="coupon-ticket-status is-used">
                                        <Check size={13} aria-hidden="true" />
                                        {record.status === 'REFUNDED'
                                            ? isZh
                                                ? '已退款返券'
                                                : 'Refunded'
                                            : isZh
                                              ? '已使用'
                                              : 'Used'}
                                    </span>
                                }
                                meta={couponUsageRecord(record, language)}
                            />
                        ))}
                    </div>
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

function CouponTicket({
    card,
    muted,
    action,
    meta,
    details,
}: {
    card: StorefrontCouponCard;
    muted?: boolean;
    action: ReactNode;
    meta?: string;
    details?: ReactNode;
}) {
    return (
        <article className="coupon-center-ticket-item">
            <div
                className={`coupon-ticket-card coupon-center-ticket coupon-ticket-${card.theme}${
                    muted ? ' is-claimed' : ''
                }`}
            >
                <div className="coupon-ticket-main">
                    <div className="coupon-ticket-top">
                        <span className="coupon-ticket-tag">{card.tag}</span>
                        <strong className="coupon-center-ticket-title">{card.title}</strong>
                    </div>
                    <div className="coupon-ticket-value">
                        {card.unitBefore ? (
                            <>
                                <small className="coupon-unit">{card.unit}</small>
                                <strong className="coupon-num">{card.value}</strong>
                            </>
                        ) : (
                            <>
                                <strong className="coupon-num">{card.value}</strong>
                                {card.unit ? <small className="coupon-unit">{card.unit}</small> : null}
                            </>
                        )}
                    </div>
                    <p className="coupon-ticket-desc">{card.description}</p>
                    {meta ? <small className="coupon-center-ticket-meta">{meta}</small> : null}
                </div>
                <div className="coupon-ticket-divider" aria-hidden="true">
                    <span className="coupon-notch coupon-notch-top" />
                    <span className="coupon-notch-line" />
                    <span className="coupon-notch coupon-notch-bottom" />
                </div>
                <div className="coupon-ticket-action">{action}</div>
            </div>
            {details}
        </article>
    );
}

function CampaignInstructions({
    campaign,
    language,
}: {
    campaign: StorefrontCouponCampaign;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    return (
        <div className="coupon-center-instructions">
            <strong>{isZh ? '使用说明' : 'Usage details'}</strong>
            <dl>
                <div>
                    <dt>
                        <CalendarDays aria-hidden="true" />
                        {isZh ? '有效期' : 'Validity'}
                    </dt>
                    <dd>{campaignValidity(campaign, language)}</dd>
                </div>
                <div>
                    <dt>
                        <MapPin aria-hidden="true" />
                        {isZh ? '适用范围' : 'Applies to'}
                    </dt>
                    <dd>{couponScopeLabel(campaign.kind, language)}</dd>
                </div>
            </dl>
        </div>
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
    const isUnused = tab === 'UNUSED';
    return (
        <EmptyState
            icon={<TicketPercent />}
            title={
                isHistory
                    ? isZh
                        ? '暂无使用记录'
                        : 'No usage records'
                    : isUnused
                      ? isZh
                          ? '暂无未使用优惠券'
                          : 'No unused coupons'
                      : isZh
                        ? '该分类暂无优惠券'
                        : 'No coupons in this category'
            }
            detail={
                isHistory
                    ? isZh
                        ? '优惠券核销后会显示在这里'
                        : 'Redeemed coupons will appear here'
                    : isUnused
                      ? isZh
                          ? '领取优惠券后会显示在这里'
                          : 'Claimed coupons will appear here'
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
        UNUSED: isZh ? '未使用' : 'Unused',
        HISTORY: isZh ? '记录' : 'History',
    }[tab];
}

function campaignValidity(campaign: StorefrontCouponCampaign, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    const locale = isZh ? 'zh-CN' : 'en-US';
    const usageWindow = dateWindow(campaign.startsAt, campaign.endsAt, locale, isZh);
    if (campaign.validityDays) {
        const relative = isZh
            ? `领取后 ${campaign.validityDays} 天内有效`
            : `Valid for ${campaign.validityDays} days after claiming`;
        const starts = campaign.startsAt
            ? `${isZh ? '可用开始 ' : 'Starts '}${formatDate(campaign.startsAt, locale)}`
            : null;
        const ends = campaign.endsAt
            ? `${isZh ? '最晚至 ' : 'No later than '}${formatDate(campaign.endsAt, locale)}`
            : null;
        return [relative, starts, ends].filter(Boolean).join(isZh ? '，' : ', ');
    }
    return usageWindow;
}

function customerCouponValidity(coupon: StoreCustomerCoupon, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    const locale = isZh ? 'zh-CN' : 'en-US';
    const validity = dateWindow(coupon.validFrom, coupon.validUntil, locale, isZh);
    return `${validity} · ${couponScopeLabel(coupon.campaignKind, language)}`;
}

function couponUsageRecord(record: StoreCouponUsageRecord, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    const locale = isZh ? 'zh-CN' : 'en-US';
    const saved = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: record.currencyCode,
    }).format(record.savedAmount / 100);
    return `${isZh ? '使用于' : 'Used'} ${formatDateTime(record.usedAt, locale)} · ${
        isZh ? '订单' : 'Order'
    } ${record.orderCode} · ${isZh ? '优惠' : 'Saved'} ${saved}`;
}

function dateWindow(startsAt: string | null, endsAt: string | null, locale: string, isZh: boolean): string {
    if (startsAt && endsAt) return `${formatDate(startsAt, locale)} – ${formatDate(endsAt, locale)}`;
    if (endsAt) return `${isZh ? '有效至' : 'Valid until'} ${formatDate(endsAt, locale)}`;
    if (startsAt)
        return `${isZh ? '自' : 'From'} ${formatDate(startsAt, locale)} ${isZh ? '起有效' : ''}`.trim();
    return isZh ? '长期有效' : 'No expiry';
}

function formatDate(value: string, locale: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value: string, locale: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
    );
}
