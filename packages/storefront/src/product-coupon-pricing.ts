import { StoreCustomerCoupon, StorefrontCouponCampaign } from './types';

export interface ProductCouponPrice {
    campaignId: string;
    campaignName: string;
    priceWithTax: number;
    savedAmount: number;
}

interface ProductCouponPriceInput {
    campaigns: StorefrontCouponCampaign[];
    customerCoupons: StoreCustomerCoupon[];
    collectionIds: string[];
    productVariantId: string;
    priceWithTax: number;
    currencyCode: string;
}

export function bestProductCouponPrice({
    campaigns,
    customerCoupons,
    collectionIds,
    productVariantId,
    priceWithTax,
    currencyCode,
}: ProductCouponPriceInput): ProductCouponPrice | null {
    if (!Number.isFinite(priceWithTax) || priceWithTax <= 0) return null;

    const now = Date.now();
    const usableCoupons = customerCoupons.filter(
        coupon =>
            coupon.usable &&
            Date.parse(coupon.validFrom) <= now &&
            (!coupon.validUntil || Date.parse(coupon.validUntil) > now),
    );
    const usableCampaignIds = new Set(usableCoupons.map(coupon => coupon.campaignId));
    const candidates = new Map(campaigns.map(campaign => [campaign.id, campaign]));
    // Issuance may have ended while this customer's entitlement is still valid.
    for (const coupon of usableCoupons) {
        candidates.set(coupon.campaignId, {
            ...candidates.get(coupon.campaignId),
            id: coupon.campaignId,
            name: coupon.campaignName,
            kind: coupon.campaignKind,
            customerEligibility: coupon.customerEligibility,
            minimumSpend: coupon.minimumSpend,
            currencyCode: coupon.currencyCode ?? currencyCode,
            discountAmount: coupon.discountAmount,
            discountRate: coupon.discountRate,
            collectionIds: coupon.collectionIds ?? [],
            productVariantIds: coupon.productVariantIds ?? [],
            startsAt: coupon.validFrom,
            endsAt: coupon.validUntil,
            claimStartsAt: null,
            claimEndsAt: null,
            validityDays: null,
            remainingIssueCount: null,
            claimed: true,
            claimable: false,
        });
    }
    const collectionIdSet = new Set(collectionIds);
    let best: ProductCouponPrice | null = null;

    for (const campaign of candidates.values()) {
        // Eligibility can change after claiming. Only the server may quote restricted customer prices.
        if (campaign.customerEligibility && campaign.customerEligibility !== 'ALL') continue;
        const owned = usableCampaignIds.has(campaign.id);
        const claimableNow =
            campaign.claimable &&
            (!campaign.claimStartsAt || Date.parse(campaign.claimStartsAt) <= now) &&
            (!campaign.claimEndsAt || Date.parse(campaign.claimEndsAt) > now);
        if (!claimableNow && !owned) continue;
        if (campaign.currencyCode && campaign.currencyCode !== currencyCode) continue;
        if (campaign.minimumSpend > priceWithTax) continue;
        if (!couponMatchesProduct(campaign, collectionIdSet, productVariantId)) continue;

        const discountedPrice = couponDiscountedPrice(campaign, priceWithTax);
        if (discountedPrice == null || discountedPrice >= priceWithTax) continue;
        if (best && best.priceWithTax <= discountedPrice) continue;

        best = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            priceWithTax: discountedPrice,
            savedAmount: priceWithTax - discountedPrice,
        };
    }

    return best;
}

function couponMatchesProduct(
    campaign: StorefrontCouponCampaign,
    collectionIds: Set<string>,
    productVariantId: string,
): boolean {
    const matchesCollection =
        !campaign.collectionIds?.length || campaign.collectionIds.some(id => collectionIds.has(id));
    const matchesVariant =
        !campaign.productVariantIds?.length || campaign.productVariantIds.includes(productVariantId);
    return matchesCollection && matchesVariant;
}

function couponDiscountedPrice(campaign: StorefrontCouponCampaign, priceWithTax: number): number | null {
    if (campaign.kind === 'ORDER_FIXED') {
        if (campaign.discountAmount == null || campaign.discountAmount <= 0) return null;
        return Math.max(0, priceWithTax - campaign.discountAmount);
    }
    if (campaign.discountRate == null || campaign.discountRate <= 0 || campaign.discountRate >= 10) {
        return null;
    }
    return Math.max(0, Math.round((priceWithTax * campaign.discountRate) / 10));
}
