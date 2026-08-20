import { ID } from '@vendure/common/lib/shared-types';

import { StorefrontReviewState } from './review.constants';

export interface SubmitStorefrontReviewInput {
    orderLineId: ID;
    rating: number;
    title: string;
    body: string;
}

export interface StorefrontReviewListOptions {
    skip?: number | null;
    take?: number | null;
    state?: StorefrontReviewState | null;
}

export interface StorefrontReviewCandidate {
    orderLineId: ID;
    orderId: ID;
    orderCode: string;
    orderState: string;
    orderPlacedAt: Date | null;
    productId: ID;
    productVariantId: ID;
    productName: string;
    variantName: string;
    sku: string;
    fulfillmentType: 'physical' | 'digital';
}

export interface ModerateStorefrontReviewInput {
    id: ID;
    state: Extract<StorefrontReviewState, 'APPROVED' | 'REJECTED'>;
    response?: string | null;
}
