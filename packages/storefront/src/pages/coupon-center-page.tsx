import { useNavigate, useRouter } from '@tanstack/react-router';
import { Badge, CalendarDays, Check, ChevronRight, MapPin, TicketPercent } from 'lucide-react';
import { ReactNode, useState } from 'react';

import {
    CouponCenterTab,
    couponCampaignActionState,
    couponCampaignsForCustomer,
    couponCampaignsForTab,
    couponCenterTabCount,
    customerCouponsForTab,
    isLockedCoupon,
} from '../coupon-center-state';
import { PageSkeleton } from '../route-loading';
import {
    StorefrontCouponCard,
    couponCardFromCustomerCoupon,
    couponCardFromUsageRecord,
    couponCardsFromCampaigns,
    couponScopeLabel,
} from '../storefront-coupons';
import { CouponCenterPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import { EmptyState, InlineError, Subpage } from '../storefront-ui/page-shell';
import {
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontCouponCampaign,
    StorefrontLanguage,
} from '../types';

export interface CouponCenterPageProps {
    coupons: StorefrontCouponCampaign[];
    myCoupons: StoreCustomerCoupon[];
    usageRecords: StoreCouponUsageRecord[];
    currencyCode: string;
    displayCurrencyCode: string;
    language: StorefrontLanguage;
    loading: boolean;
    campaignsLoading: boolean;
    campaignsError: string;
    myCouponsLoading: boolean;
    myCouponsError: string;
    usageRecordsLoading: boolean;
    usageRecordsError: string;
    onRetryCampaigns: () => void;
    onRetryMyCoupons: () => void;
    onRetryUsageRecords: () => void;
    onClaim: (campaignId: string) => Promise<string | null>;
}

const tabs: CouponCenterTab[] = ['ACTIVITIES', 'UNCLAIMED', 'UNUSED', 'HISTORY'];

export function CouponCenterPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const {
        coupons,
        myCoupons,
        usageRecords,
        currencyCode,
        displayCurrencyCode,
        language,
        loading,
        campaignsLoading,
        campaignsError,
        myCouponsLoading,
        myCouponsError,
        usageRecordsLoading,
        usageRecordsError,
        onRetryCampaigns,
        onRetryMyCoupons,
        onRetryUsageRecords,
        onClaim,
    } = CouponCenterPageContext.useValue();
    const isZh = language === 'zh';
    const [activeTab, setActiveTab] = useState<CouponCenterTab>('ACTIVITIES');
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const ownershipLoadState = myCouponsLoading
        ? 'loading'
        : myCouponsError && myCoupons.length === 0
          ? 'error'
          : 'ready';
    const campaignLoadState = campaignsLoading
        ? 'loading'
        : campaignsError && coupons.length === 0
          ? 'error'
          : 'ready';
    const customerAwareCampaigns =
        ownershipLoadState === 'ready' ? couponCampaignsForCustomer(coupons, myCoupons) : coupons;
    const campaignCards = couponCardsFromCampaigns(
        customerAwareCampaigns,
        language,
        currencyCode,
        displayCurrencyCode,
    );
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
                            {couponTabCountDisplay(
                                tab,
                                couponCenterTabCount(tab, customerAwareCampaigns, myCoupons, usageRecords),
                                campaignsLoading,
                                campaignsError,
                                myCouponsLoading,
                                myCouponsError,
                                usageRecordsLoading,
                                usageRecordsError,
                            )}
                        </small>
                    </button>
                ))}
            </nav>

            {(activeTab === 'ACTIVITIES' || activeTab === 'UNCLAIMED') && campaignLoadState !== 'ready' ? (
                <CouponQueryBoundary
                    loading={campaignsLoading}
                    error={campaignsError}
                    hasData={false}
                    language={language}
                    onRetry={onRetryCampaigns}
                    empty={<CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />}
                >
                    {null}
                </CouponQueryBoundary>
            ) : activeTab === 'UNCLAIMED' && ownershipLoadState !== 'ready' ? (
                <CouponQueryBoundary
                    loading={myCouponsLoading}
                    error={myCouponsError}
                    hasData={false}
                    language={language}
                    onRetry={onRetryMyCoupons}
                    empty={<CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />}
                >
                    {null}
                </CouponQueryBoundary>
            ) : activeTab === 'ACTIVITIES' || activeTab === 'UNCLAIMED' ? (
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
                        {campaignsError ? (
                            <div className="coupon-center-query-state is-inline">
                                <InlineError
                                    message={campaignsError}
                                    action={isZh ? '重试' : 'Retry'}
                                    onAction={onRetryCampaigns}
                                />
                            </div>
                        ) : null}
                        <div className="coupon-center-ticket-list">
                            {visibleCampaignCards.map(card => {
                                const campaign = customerAwareCampaigns.find(
                                    item => item.id === card.campaignId,
                                );
                                if (!campaign) return null;
                                const actionState = couponCampaignActionState(
                                    campaign,
                                    language,
                                    ownershipLoadState,
                                );
                                const { canClaim } = actionState;
                                const action = (
                                    <button
                                        type="button"
                                        className={`${
                                            activeTab === 'ACTIVITIES'
                                                ? 'coupon-activity-action'
                                                : 'coupon-claim-btn'
                                        }${canClaim ? '' : ' is-claimed'}${
                                            actionState.detail ? ' is-unavailable' : ''
                                        }`}
                                        disabled={!canClaim || loading || claimingId !== null}
                                        onClick={() => void claim(campaign.id)}
                                    >
                                        <span className="coupon-btn-text-wrap">
                                            <span>
                                                {activeTab === 'UNCLAIMED' && canClaim && isZh
                                                    ? '领取'
                                                    : actionState.label}
                                            </span>
                                            {actionState.detail ? <small>{actionState.detail}</small> : null}
                                            {campaign.claimed ? (
                                                <Check size={13} aria-hidden="true" />
                                            ) : canClaim ? (
                                                <ChevronRight size={15} aria-hidden="true" />
                                            ) : null}
                                        </span>
                                    </button>
                                );
                                return activeTab === 'ACTIVITIES' ? (
                                    <ActivityCoupon
                                        key={card.id}
                                        card={card}
                                        campaign={campaign}
                                        language={language}
                                        muted={!canClaim}
                                        action={action}
                                    />
                                ) : (
                                    <CouponTicket
                                        key={card.id}
                                        card={card}
                                        muted={!canClaim}
                                        action={action}
                                        meta={campaignValidity(campaign, language)}
                                    />
                                );
                            })}
                        </div>
                    </section>
                ) : (
                    <CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />
                )
            ) : activeTab === 'UNUSED' ? (
                <CouponQueryBoundary
                    loading={myCouponsLoading}
                    error={myCouponsError}
                    hasData={visibleCustomerCoupons.length > 0}
                    language={language}
                    onRetry={onRetryMyCoupons}
                    empty={<CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />}
                >
                    <section className="coupon-center-panel" aria-busy={loading}>
                        <div className="coupon-center-ticket-list">
                            {visibleCustomerCoupons.map((coupon, index) => {
                                const card = couponCardFromCustomerCoupon(
                                    coupon,
                                    language,
                                    currencyCode,
                                    index,
                                    displayCurrencyCode,
                                );
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
                                                        <ChevronRight size={15} aria-hidden="true" />
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
                </CouponQueryBoundary>
            ) : (
                <CouponQueryBoundary
                    loading={usageRecordsLoading}
                    error={usageRecordsError}
                    hasData={usageRecords.length > 0}
                    language={language}
                    onRetry={onRetryUsageRecords}
                    empty={<CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />}
                >
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
                </CouponQueryBoundary>
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

export function couponTabCountDisplay(
    tab: CouponCenterTab,
    count: number,
    campaignsLoading: boolean,
    campaignsError: string,
    myCouponsLoading: boolean,
    myCouponsError: string,
    usageRecordsLoading: boolean,
    usageRecordsError: string,
): number | string {
    const campaignDependent = tab === 'ACTIVITIES' || tab === 'UNCLAIMED';
    const ownershipDependent = tab === 'UNCLAIMED' || tab === 'UNUSED';
    const loading =
        (campaignDependent && campaignsLoading) ||
        (ownershipDependent && myCouponsLoading) ||
        (tab === 'HISTORY' && usageRecordsLoading);
    const error =
        (campaignDependent && campaignsError) ||
        (ownershipDependent && myCouponsError) ||
        (tab === 'HISTORY' && usageRecordsError) ||
        '';
    if (tab === 'UNCLAIMED' && error) return '—';
    if (tab === 'UNCLAIMED' && loading) return '…';
    if (count === 0 && error) return '—';
    if (count === 0 && loading) return '…';
    return count;
}

export function CouponQueryBoundary({
    loading,
    error,
    hasData,
    language,
    onRetry,
    empty,
    children,
}: {
    loading: boolean;
    error: string;
    hasData: boolean;
    language: StorefrontLanguage;
    onRetry: () => void;
    empty: ReactNode;
    children: ReactNode;
}) {
    const isZh = language === 'zh';
    if (error && !hasData) {
        return (
            <div className="coupon-center-query-state">
                <InlineError message={error} action={isZh ? '重试' : 'Retry'} onAction={onRetry} />
            </div>
        );
    }
    if (loading && !hasData) {
        return (
            <div className="coupon-center-query-state">
                <PageSkeleton
                    label={isZh ? '正在加载优惠券数据' : 'Loading coupon data'}
                    language={language}
                    variant="account"
                />
            </div>
        );
    }
    return (
        <>
            {error ? (
                <div className="coupon-center-query-state">
                    <InlineError message={error} action={isZh ? '重试' : 'Retry'} onAction={onRetry} />
                </div>
            ) : null}
            {hasData ? children : empty}
        </>
    );
}

function CouponTicket({
    card,
    muted,
    action,
    meta,
}: {
    card: StorefrontCouponCard;
    muted?: boolean;
    action: ReactNode;
    meta?: string;
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
                    </div>
                    <div className={`coupon-ticket-value${card.unitBefore ? ' is-unit-before' : ''}`}>
                        <Badge className="coupon-ticket-seal" aria-hidden="true" />
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
                <div className="coupon-ticket-action">{action}</div>
            </div>
        </article>
    );
}

function ActivityCoupon({
    card,
    campaign,
    language,
    muted,
    action,
}: {
    card: StorefrontCouponCard;
    campaign: StorefrontCouponCampaign;
    language: StorefrontLanguage;
    muted?: boolean;
    action: ReactNode;
}) {
    return (
        <article className={`coupon-activity-card coupon-ticket-${card.theme}${muted ? ' is-claimed' : ''}`}>
            <div className="coupon-activity-hero">
                <div className="coupon-activity-topline">
                    <span className="coupon-activity-tag">{card.tag}</span>
                    {action}
                </div>
                <div className={`coupon-activity-value${card.unitBefore ? ' is-unit-before' : ''}`}>
                    {card.unitBefore ? (
                        <>
                            <small>{card.unit}</small>
                            <strong>{card.value}</strong>
                        </>
                    ) : (
                        <>
                            <strong>{card.value}</strong>
                            {card.unit ? <small>{card.unit}</small> : null}
                        </>
                    )}
                </div>
                <p>
                    <strong>{card.title}</strong>
                    <span aria-hidden="true"> · </span>
                    <span>{card.description}</span>
                </p>
            </div>
            <CampaignInstructions campaign={campaign} language={language} />
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
        <div
            className="coupon-center-instructions"
            role="group"
            aria-label={isZh ? '使用说明' : 'Usage details'}
        >
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
    return dateWindow(coupon.validFrom, coupon.validUntil, locale, isZh);
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
