/** Public synthetic campaigns only; never supply customer claims or identity. */
export function preparedCampaigns() {
    return [
        {
            id: 'qa-prepared-coupon',
            name: '本地匿名合成优惠',
            kind: 'ORDER_FIXED',
            appearanceTheme: 'rose',
            minimumSpend: 1000,
            currencyCode: 'MYR',
            discountAmount: 100,
            discountRate: null,
            validityDays: null,
            startsAt: null,
            endsAt: null,
            claimStartsAt: null,
            claimEndsAt: null,
            collectionIds: [],
            productVariantIds: [],
            remainingIssueCount: 5,
            claimed: false,
            claimable: true,
        },
    ];
}

export function applyCouponScenario(page, scenario, pageData = false) {
    delete page.couponCampaigns;
    delete page.couponAudience;
    // Older snapshots omit both additive fields. A later public read may prepare
    // a result, but the current homepage must retain its first-frame decision.
    if (scenario === 'old' || (scenario === 'late' && !pageData)) return;
    page.couponAudience = scenario === 'targeted' ? 'unknown' : 'anonymous';
    page.couponCampaigns = ['prepared', 'targeted', 'late'].includes(scenario) ? preparedCampaigns() : [];
}
