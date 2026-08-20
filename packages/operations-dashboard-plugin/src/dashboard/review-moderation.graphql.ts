import { gql } from 'graphql-tag';

export type ReviewState = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ReviewRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: ReviewState;
    rating: number;
    title: string;
    body: string;
    customerName: string;
    productName: string;
    sku: string;
    merchantResponse: string | null;
    moderatedAt: string | null;
    orderLineId: string | null;
    productId: string | null;
    productVariantId: string | null;
    verifiedPurchase: boolean;
}

export interface ReviewsResult {
    storefrontReviews: {
        items: ReviewRecord[];
        totalItems: number;
    };
}

export const reviewsQuery = gql`
    query OperationsStorefrontReviews($options: StorefrontReviewListOptions) {
        storefrontReviews(options: $options) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                state
                rating
                title
                body
                customerName
                productName
                sku
                merchantResponse
                moderatedAt
                orderLineId
                productId
                productVariantId
                verifiedPurchase
            }
        }
    }
`;

export const moderateReviewMutation = gql`
    mutation OperationsModerateStorefrontReview($input: ModerateStorefrontReviewInput!) {
        moderateStorefrontReview(input: $input) {
            id
            state
            merchantResponse
            moderatedAt
            updatedAt
        }
    }
`;
