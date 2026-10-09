import '../styles/coupon-center.css';
// organize-imports-ignore
import type { ShopApi } from '../api';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowRight, Check, TicketPercent } from 'lucide-react';
import { ReactNode, useState } from 'react';

import { DesktopCouponTicket } from '../components/common/desktop-coupon-ticket';
import {
    CouponCenterTab,
    couponCampaignActionState,
    couponCampaignsForCustomer,
    couponCampaignsForTab,
    couponCenterTabCount,
    customerCouponsForTab,
    isLockedCoupon,
} from '../coupon-center-state';
import { storefrontInitialQueryError } from '../loading-state';
import { PageSkeleton } from '../route-loading';
import {
    StorefrontCouponCard,
    couponCardFromCustomerCoupon,
    couponCardFromUsageRecord,
    couponCardsFromCampaigns,
    couponScopeLabel,
} from '../storefront-coupons';
import { storefrontErrorMessage } from '../storefront-errors';
import { CouponCenterPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import { EmptyState, InlineError, Subpage, SubpageBody } from '../storefront-ui/page-shell';
import {
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontCouponCampaign,
    StorefrontLanguage,
} from '../types';

export interface CouponCenterPageProps {
    pagination?: { api: ShopApi; queryKey: readonly unknown[] };
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
    const goBack = () => {
        if (router.history.canGoBack()) router.history.back();
        else navigateTo({ name: 'home' });
    };
    const {
        coupons,
        myCoupons,
        usageRecords: initialUsageRecords,
        pagination,
        currencyCode,
        displayCurrencyCode,
        language,
        loading,
        campaignsLoading,
        campaignsError,
        myCouponsLoading: initialMyCouponsLoading,
        myCouponsError: initialMyCouponsError,
        usageRecordsLoading: initialUsageRecordsLoading,
        usageRecordsError: initialUsageRecordsError,
        onRetryCampaigns,
        onRetryMyCoupons,
        onRetryUsageRecords,
        onClaim,
    } = CouponCenterPageContext.useValue();
    const isZh = language === 'zh';
    const [activeTab, setActiveTab] = useState<CouponCenterTab>('ACTIVITIES');
    const [page, setPage] = useState(0);
    const pageSize = 20;
    const ownedPage = useQuery({
        queryKey: [
            ...(pagination?.queryKey ?? ['coupon-center']),
            'owned-page',
            activeTab === 'UNUSED' ? page : 0,
        ],
        queryFn: ({ signal }) =>
            pagination
                ? pagination.api.myCouponsPage(
                      {
                          skip: (activeTab === 'UNUSED' ? page : 0) * pageSize,
                          take: pageSize,
                          statuses: ['AVAILABLE', 'RETURNED', 'LOCKED'],
                      },
                      signal,
                  )
                : Promise.resolve({ items: [], totalItems: 0 }),
        enabled: Boolean(pagination),
        staleTime: 0,
    });
    const historyPage = useQuery({
        queryKey: [
            ...(pagination?.queryKey ?? ['coupon-center']),
            'usage-page',
            activeTab === 'HISTORY' ? page : 0,
        ],
        queryFn: ({ signal }) =>
            pagination
                ? pagination.api.myCouponUsageRecordsPage(
                      { skip: (activeTab === 'HISTORY' ? page : 0) * pageSize, take: pageSize },
                      signal,
                  )
                : Promise.resolve({ items: [], totalItems: 0 }),
        enabled: Boolean(pagination),
        staleTime: 0,
    });
    const usageRecords = pagination ? (historyPage.data?.items ?? []) : initialUsageRecords;
    const unusedCouponsLoading = pagination ? ownedPage.isLoading : initialMyCouponsLoading;
    const unusedCouponsError = pagination
        ? storefrontInitialQueryError(ownedPage, language)
        : initialMyCouponsError;
    const myCouponsLoading = activeTab === 'UNUSED' ? unusedCouponsLoading : initialMyCouponsLoading;
    const usageRecordsLoading = pagination ? historyPage.isLoading : initialUsageRecordsLoading;
    const myCouponsError = activeTab === 'UNUSED' ? unusedCouponsError : initialMyCouponsError;
    const usageRecordsError = pagination
        ? storefrontInitialQueryError(historyPage, language)
        : initialUsageRecordsError;
    const totalItems =
        activeTab === 'UNUSED' ? (ownedPage.data?.totalItems ?? 0) : (historyPage.data?.totalItems ?? 0);
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
    const visibleCustomerCoupons = customerCouponsForTab(
        pagination ? (ownedPage.data?.items ?? []) : myCoupons,
        activeTab,
    );

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
        <Subpage
            className="coupon-center-page"
            title={isZh ? '优惠券中心' : 'Coupon center'}
            language={language}
            onBack={goBack}
        >
            <SubpageBody>
                <div className="coupon-center-workspace">
                    <nav
                        className="coupon-center-tabs"
                        aria-label={isZh ? '优惠券分类' : 'Coupon categories'}
                    >
                        {tabs.map(tab => (
                            <button
                                key={tab}
                                type="button"
                                className={activeTab === tab ? 'is-active' : ''}
                                aria-current={activeTab === tab ? 'page' : undefined}
                                onClick={() => {
                                    setActiveTab(tab);
                                    setPage(0);
                                }}
                            >
                                <span>{tabLabel(tab, language)}</span>
                                <small>
                                    {couponTabCountDisplay(
                                        tab,
                                        pagination && tab === 'UNUSED'
                                            ? (ownedPage.data?.totalItems ?? 0)
                                            : pagination && tab === 'HISTORY'
                                              ? (historyPage.data?.totalItems ?? 0)
                                              : couponCenterTabCount(
                                                    tab,
                                                    customerAwareCampaigns,
                                                    myCoupons,
                                                    usageRecords,
                                                ),
                                        campaignsLoading,
                                        campaignsError,
                                        tab === 'UNUSED' ? unusedCouponsLoading : myCouponsLoading,
                                        tab === 'UNUSED' ? unusedCouponsError : myCouponsError,
                                        usageRecordsLoading,
                                        usageRecordsError,
                                    )}
                                </small>
                            </button>
                        ))}
                    </nav>

                    {(activeTab === 'ACTIVITIES' || activeTab === 'UNCLAIMED') &&
                    campaignLoadState !== 'ready' ? (
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
                                                className={`coupon-claim-btn${canClaim ? '' : ' is-claimed'}${
                                                    actionState.detail ? ' is-unavailable' : ''
                                                }${claimingId === campaign.id ? ' is-claiming' : ''}`}
                                                disabled={!canClaim || loading || claimingId !== null}
                                                aria-busy={claimingId === campaign.id}
                                                onClick={() => void claim(campaign.id)}
                                            >
                                                <span className="coupon-btn-text-wrap">
                                                    <span>
                                                        {claimingId === campaign.id
                                                            ? isZh
                                                                ? '领取中'
                                                                : 'Claiming'
                                                            : canClaim && isZh
                                                              ? '领取'
                                                              : actionState.label}
                                                    </span>
                                                    {actionState.detail ? (
                                                        <small>{actionState.detail}</small>
                                                    ) : null}
                                                    {campaign.claimed ? (
                                                        <Check size={13} aria-hidden="true" />
                                                    ) : null}
                                                </span>
                                            </button>
                                        );
                                        return (
                                            <CouponTicket
                                                key={card.id}
                                                card={card}
                                                action={action}
                                                meta={
                                                    <CampaignDetails
                                                        campaign={campaign}
                                                        language={language}
                                                    />
                                                }
                                                scope={couponScopeSummary(campaign.kind, language)}
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
                            onRetry={
                                pagination
                                    ? () => void ownedPage.refetch({ cancelRefetch: false })
                                    : onRetryMyCoupons
                            }
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
                                                unavailable={locked}
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
                                                meta={
                                                    <CouponDetails
                                                        rows={[
                                                            [
                                                                isZh ? '有效期' : 'Validity',
                                                                customerCouponValidity(coupon, language),
                                                            ],
                                                            ...(coupon.status === 'RETURNED'
                                                                ? [
                                                                      [
                                                                          isZh ? '状态' : 'Status',
                                                                          isZh ? '已返还' : 'Returned',
                                                                      ] as [string, string],
                                                                  ]
                                                                : []),
                                                        ]}
                                                    />
                                                }
                                                scope={couponScopeSummary(coupon.campaignKind, language)}
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
                            onRetry={
                                pagination
                                    ? () => void historyPage.refetch({ cancelRefetch: false })
                                    : onRetryUsageRecords
                            }
                            empty={<CouponTabEmpty tab={activeTab} language={language} onShop={shopNow} />}
                        >
                            <section className="coupon-center-panel" aria-busy={loading}>
                                <div className="coupon-center-ticket-list">
                                    {usageRecords.map((record, index) => (
                                        <CouponTicket
                                            key={record.id}
                                            card={couponCardFromUsageRecord(record, language, index)}
                                            historical
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
                                            meta={<CouponUsageDetails record={record} language={language} />}
                                            scope={couponScopeSummary(record.campaignKind, language)}
                                        />
                                    ))}
                                </div>
                            </section>
                        </CouponQueryBoundary>
                    )}

                    {pagination &&
                    (activeTab === 'UNUSED' || activeTab === 'HISTORY') &&
                    (totalItems > pageSize || page > 0) ? (
                        <nav
                            className="coupon-center-pagination"
                            aria-label={isZh ? '优惠券分页' : 'Coupon pages'}
                        >
                            <button
                                type="button"
                                disabled={page === 0 || myCouponsLoading || usageRecordsLoading}
                                onClick={() => setPage(value => value - 1)}
                            >
                                {isZh ? '上一页' : 'Previous'}
                            </button>
                            <span aria-live="polite">
                                {page + 1} / {Math.max(1, Math.ceil(totalItems / pageSize))} ·{' '}
                                {isZh ? `共 ${totalItems} 条` : `${totalItems} total`}
                            </span>
                            <button
                                type="button"
                                disabled={
                                    (page + 1) * pageSize >= totalItems ||
                                    myCouponsLoading ||
                                    usageRecordsLoading
                                }
                                onClick={() => setPage(value => value + 1)}
                            >
                                {isZh ? '下一页' : 'Next'}
                            </button>
                        </nav>
                    ) : null}
                    {error ? (
                        <small className="form-error coupon-center-error" role="alert">
                            {error}
                        </small>
                    ) : null}
                </div>
                <section
                    className="coupon-center-guide"
                    aria-label={isZh ? '使用说明' : 'Using your coupons'}
                >
                    <h2>{isZh ? '使用说明' : 'Using your coupons'}</h2>
                    <p>
                        {isZh
                            ? '请查看券面的使用门槛、适用范围和有效期。'
                            : 'Check the minimum spend, eligible items and validity on each coupon.'}
                    </p>
                    <p>
                        {isZh
                            ? '可用优惠及折扣明细可在购物车查看，最终应付金额以结算页为准。'
                            : 'Review available coupons and savings in your cart. Checkout confirms the final amount.'}
                    </p>
                    <button
                        className="coupon-center-cart-link"
                        type="button"
                        onClick={() => navigateTo({ name: 'cart' })}
                    >
                        <span>{isZh ? '查看购物车和优惠明细' : 'View cart and discount details'}</span>
                        <ArrowRight aria-hidden="true" />
                    </button>
                </section>
            </SubpageBody>
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
    unavailable = false,
    historical = false,
    action,
    meta,
    scope,
}: {
    card: StorefrontCouponCard;
    unavailable?: boolean;
    historical?: boolean;
    action: ReactNode;
    meta?: ReactNode;
    scope: string;
}) {
    return (
        <DesktopCouponTicket
            variant="full"
            card={card}
            action={action}
            meta={meta}
            scope={scope}
            unavailable={unavailable}
            historical={historical}
        />
    );
}

function couponScopeSummary(kind: StorefrontCouponCampaign['kind'], language: StorefrontLanguage): string {
    return `${language === 'zh' ? '适用范围：' : 'Applies to: '}${couponScopeLabel(kind, language)}`;
}

function CouponDetails({ rows }: { rows: Array<[string, string]> }) {
    return (
        <dl className="coupon-center-details">
            {rows.map(([label, value]) => (
                <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

function CampaignDetails({
    campaign,
    language,
}: {
    campaign: StorefrontCouponCampaign;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const locale = isZh ? 'zh-CN' : 'en-US';
    const rows: Array<[string, string]> = [];
    if (campaign.claimStartsAt || campaign.claimEndsAt) {
        const starts = campaign.claimStartsAt ? formatDateTime(campaign.claimStartsAt, locale) : null;
        const ends = campaign.claimEndsAt ? formatDateTime(campaign.claimEndsAt, locale) : null;
        const window =
            starts && ends
                ? `${starts} – ${ends}`
                : ends
                  ? `${isZh ? '截止 ' : 'Until '}${ends}`
                  : `${isZh ? '开始 ' : 'From '}${starts}`;
        rows.push([isZh ? '领取时间' : 'Claim period', window]);
    }
    rows.push([isZh ? '有效期' : 'Validity', campaignValidity(campaign, language)]);
    return <CouponDetails rows={rows} />;
}

function CouponUsageDetails({
    record,
    language,
}: {
    record: StoreCouponUsageRecord;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const locale = isZh ? 'zh-CN' : 'en-US';
    const saved = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: record.currencyCode,
    }).format(record.savedAmount / 100);
    const rows: Array<[string, string]> = [
        [isZh ? '使用时间' : 'Used on', formatDateTime(record.usedAt, locale)],
        [isZh ? '订单' : 'Order', record.orderCode],
        [isZh ? '实省金额' : 'Saved', saved],
    ];
    if (record.status === 'REFUNDED' && record.refundedAt) {
        rows.push([isZh ? '退款时间' : 'Refunded on', formatDateTime(record.refundedAt, locale)]);
    }
    return <CouponDetails rows={rows} />;
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
        HISTORY: isZh ? '使用记录' : 'History',
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
            ? `${isZh ? '可用开始 ' : 'Starts '}${formatDateTime(campaign.startsAt, locale)}`
            : null;
        const ends = campaign.endsAt
            ? `${isZh ? '最晚至 ' : 'No later than '}${formatDateTime(campaign.endsAt, locale)}`
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

function dateWindow(startsAt: string | null, endsAt: string | null, locale: string, isZh: boolean): string {
    if (startsAt && endsAt) return `${formatDateTime(startsAt, locale)} – ${formatDateTime(endsAt, locale)}`;
    if (endsAt) return `${isZh ? '有效至' : 'Valid until'} ${formatDateTime(endsAt, locale)}`;
    if (startsAt)
        return `${isZh ? '自' : 'From'} ${formatDateTime(startsAt, locale)} ${isZh ? '起有效' : ''}`.trim();
    return isZh ? '长期有效' : 'No expiry';
}

function formatDateTime(value: string, locale: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
    );
}
