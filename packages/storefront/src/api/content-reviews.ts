import type {
    AfterSalesRequest,
    CreateAfterSalesRequestInput,
    StorefrontConfig,
    StorefrontContentResponse,
    StorefrontCouponCampaign,
    StorefrontCurrencyConfiguration,
    StorefrontReview,
    StorefrontReviewCandidate,
    StorefrontReviewList,
    SubmitStorefrontReviewInput,
} from '../types';

import { BaseDomainApi } from './base-domain-api';
import { afterSalesFields, storefrontReviewFields } from './fragments';
import { isStorefrontContentSchemaCompatibilityError, type StorefrontContentQueryResult } from './helpers';

export class ContentReviewsApi extends BaseDomainApi {
    async storefrontConfig(signal?: AbortSignal): Promise<StorefrontConfig> {
        const result = await this.request<{
            activeChannel: Omit<StorefrontConfig, 'availableCountries' | 'logoUrl' | 'description'>;
            availableCountries: StorefrontConfig['availableCountries'];
            storefrontBranding: { logoUrl: string | null; description: string };
            storefrontCurrencyConfiguration: StorefrontCurrencyConfiguration;
        }>(
            `
            query StorefrontConfig {
                activeChannel {
                    code
                    defaultLanguageCode
                    defaultCurrencyCode
                    customFields {
                        storefrontNameZh
                        storefrontNameEn
                    }
                }
                availableCountries {
                    code
                    name
                }
                storefrontBranding {
                    logoUrl
                    description
                }
                storefrontCurrencyConfiguration {
                    defaultCurrencyCode
                    availableCurrencyCodes
                    selectorEnabled
                    cnyToMyrRate
                    rateUpdatedAt
                    usdtDisplayEnabled
                    usdtMarkupPercent
                    cnyPerUsdtRate
                    myrPerUsdtRate
                    usdtRateSource
                    usdtRateUpdatedAt
                    usdtRateAvailable
                }
            }
        `,
            undefined,
            signal,
        );
        return {
            ...result.activeChannel,
            availableCountries: result.availableCountries,
            logoUrl: result.storefrontBranding?.logoUrl ?? null,
            description: result.storefrontBranding?.description ?? '',
            currencyConfiguration: result.storefrontCurrencyConfiguration,
        };
    }

    async storefrontContent(signal?: AbortSignal): Promise<StorefrontContentResponse> {
        let result: StorefrontContentQueryResult;
        try {
            result = await this.request<StorefrontContentQueryResult>(
                `
            query StorefrontContent {
                storefrontContentSettings {
                    heroAutoplayIntervalSeconds
                    configuredBlockTypes
                }
                activeStorefrontFlashSales {
                    id
                    startsAt
                    endsAt
                    items {
                        productId
                        productVariantId
                        productName
                        variantName
                        originalPrice
                        salePrice
                        currencyCode
                        imageUrl
                    }
                }
                activeSystemAnnouncements {
                    id
                    title
                    content
                    linkUrl
                    startsAt
                    endsAt
                }
                storefrontContent {
                    id
                    code
                    internalName
                    type
                    layoutVariant
                    enabled
                    position
                    startsAt
                    endsAt
                    imageUrl
                    backgroundColor
                    textColor
                    targetType
                    targetValue
                    settings
                    title
                    subtitle
                    body
                    ctaLabel
                    items {
                        id
                        enabled
                        position
                        imageUrl
                        targetType
                        targetValue
                        settings
                        label
                        description
                    }
                }
            }
        `,
                undefined,
                signal,
            );
        } catch (error) {
            if (!isStorefrontContentSchemaCompatibilityError(error)) {
                throw error;
            }
            result = await this.request<StorefrontContentQueryResult>(
                `
                query StorefrontContentLegacy {
                    storefrontContentSettings {
                        heroAutoplayIntervalSeconds
                    }
                    storefrontContent {
                        id
                        code
                        type
                        enabled
                        position
                        startsAt
                        endsAt
                        imageUrl
                        backgroundColor
                        textColor
                        targetType
                        targetValue
                        title
                        subtitle
                        body
                        ctaLabel
                        items {
                            id
                            enabled
                            position
                            imageUrl
                            targetType
                            targetValue
                            label
                            description
                        }
                    }
                }
            `,
                undefined,
                signal,
            );
        }
        return {
            blocks: result.storefrontContent,
            flashSales: result.activeStorefrontFlashSales ?? [],
            systemAnnouncements: result.activeSystemAnnouncements ?? [],
            settings: {
                heroAutoplayIntervalSeconds:
                    result.storefrontContentSettings?.heroAutoplayIntervalSeconds ?? 5,
                configuredBlockTypes: result.storefrontContentSettings?.configuredBlockTypes ?? [],
            },
        };
    }

    async activeCouponCampaigns(signal?: AbortSignal): Promise<StorefrontCouponCampaign[]> {
        try {
            const result = await this.request<{ activeStorefrontCoupons: StorefrontCouponCampaign[] }>(
                `
                query ActiveStorefrontCoupons {
                    activeStorefrontCoupons {
                        id
                        name
                        kind
                        startsAt
                        endsAt
                        claimStartsAt
                        claimEndsAt
                        validityDays
                        minimumSpend
                        currencyCode
                        discountAmount
                        discountRate
                        collectionIds
                        productVariantIds
                        remainingIssueCount
                        claimed
                        claimable
                    }
                }
            `,
                undefined,
                signal,
            );
            return result.activeStorefrontCoupons;
        } catch (error) {
            if (isStorefrontContentSchemaCompatibilityError(error)) return [];
            throw error;
        }
    }

    async afterSalesRequests(signal?: AbortSignal): Promise<AfterSalesRequest[]> {
        const result = await this.request<{ myAfterSalesRequests: AfterSalesRequest[] }>(
            `
                query MyAfterSalesRequests {
                    myAfterSalesRequests { ${afterSalesFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myAfterSalesRequests;
    }

    async createAfterSalesRequest(input: CreateAfterSalesRequestInput): Promise<AfterSalesRequest> {
        const result = await this.request<{ createAfterSalesRequest: AfterSalesRequest }>(
            `
                mutation CreateAfterSalesRequest($input: CreateAfterSalesRequestInput!) {
                    createAfterSalesRequest(input: $input) { ${afterSalesFields} }
                }
            `,
            { input },
        );
        return result.createAfterSalesRequest;
    }

    async cancelAfterSalesRequest(id: string): Promise<AfterSalesRequest> {
        const result = await this.request<{ cancelMyAfterSalesRequest: AfterSalesRequest }>(
            `
                mutation CancelMyAfterSalesRequest($id: ID!) {
                    cancelMyAfterSalesRequest(id: $id) { ${afterSalesFields} }
                }
            `,
            { id },
        );
        return result.cancelMyAfterSalesRequest;
    }

    async productReviews(productId: string, signal?: AbortSignal): Promise<StorefrontReviewList> {
        const result = await this.request<{ storefrontProductReviews: StorefrontReviewList }>(
            `
                query StorefrontProductReviews($productId: ID!) {
                    storefrontProductReviews(productId: $productId, options: { take: 20 }) {
                        totalItems
                        averageRating
                        items { ${storefrontReviewFields} }
                    }
                }
            `,
            { productId },
            signal,
        );
        return result.storefrontProductReviews;
    }

    async myReviews(signal?: AbortSignal): Promise<StorefrontReview[]> {
        const result = await this.request<{ myStorefrontReviews: StorefrontReview[] }>(
            `
                query MyStorefrontReviews {
                    myStorefrontReviews { ${storefrontReviewFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontReviews;
    }

    async reviewCandidates(signal?: AbortSignal): Promise<StorefrontReviewCandidate[]> {
        const result = await this.request<{ myStorefrontReviewCandidates: StorefrontReviewCandidate[] }>(
            `
                query MyStorefrontReviewCandidates {
                    myStorefrontReviewCandidates {
                        orderLineId
                        orderId
                        orderCode
                        orderState
                        orderPlacedAt
                        productId
                        productVariantId
                        productName
                        variantName
                        sku
                        fulfillmentType
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontReviewCandidates;
    }

    async submitReview(input: SubmitStorefrontReviewInput): Promise<StorefrontReview> {
        const result = await this.request<{ submitStorefrontReview: StorefrontReview }>(
            `
                mutation SubmitStorefrontReview($input: SubmitStorefrontReviewInput!) {
                    submitStorefrontReview(input: $input) { ${storefrontReviewFields} }
                }
            `,
            { input },
        );
        return result.submitStorefrontReview;
    }
}
