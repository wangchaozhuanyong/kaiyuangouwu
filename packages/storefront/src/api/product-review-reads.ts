import type { StorefrontReview, StorefrontReviewCandidate, StorefrontReviewList } from '../types';

import { BaseDomainApi } from './base-domain-api';
import { storefrontReviewFields } from './fragments';

/** Loaded only when a review view reads its data; writes remain with their current owner. */
export class ProductReviewReads extends BaseDomainApi {
    async reviewSettings(signal?: AbortSignal): Promise<{ enabled: boolean }> {
        const result = await this.request<{ storefrontReviewSettings: { enabled: boolean } }>(
            `query StorefrontReviewSettings { storefrontReviewSettings { enabled } }`,
            undefined,
            signal,
        );
        return result.storefrontReviewSettings;
    }

    async productReviews(
        productId: string,
        options: { skip?: number; take?: number } = { take: 20 },
        signal?: AbortSignal,
    ): Promise<StorefrontReviewList> {
        const result = await this.request<{ storefrontProductReviews: StorefrontReviewList }>(
            `
                query StorefrontProductReviews($productId: ID!, $options: StorefrontReviewListOptions) {
                    storefrontProductReviews(productId: $productId, options: $options) {
                        totalItems
                        averageRating
                        items { ${storefrontReviewFields} }
                    }
                }
            `,
            { productId, options },
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

    async reviewCandidates(
        options: { skip?: number; take?: number } = {},
        signal?: AbortSignal,
    ): Promise<StorefrontReviewCandidate[]> {
        const result = await this.request<{ myStorefrontReviewCandidates: StorefrontReviewCandidate[] }>(
            `
                query MyStorefrontReviewCandidates($options: StorefrontReviewListOptions) {
                    myStorefrontReviewCandidates(options: $options) {
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
                        unitPriceWithTax
                        currencyCode
                        fulfillmentType
                        imageUrl
                    }
                }
            `,
            { options },
            signal,
        );
        return result.myStorefrontReviewCandidates;
    }
}
