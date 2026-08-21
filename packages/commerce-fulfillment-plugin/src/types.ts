import { ID } from '@vendure/common/lib/shared-types';
import {
    CustomOrderFields,
    CustomOrderLineFields,
    CustomProductVariantFields,
} from '@vendure/core/dist/entity/custom-entity-fields';

import { AfterSalesReason, AfterSalesState, AfterSalesType } from './after-sales.constants';

export type FulfillmentType = 'physical' | 'digital';

export interface CreateAfterSalesItemInput {
    orderLineId: ID;
    quantity: number;
}

export interface CreateAfterSalesRequestInput {
    orderId: ID;
    type: AfterSalesType;
    reason: AfterSalesReason;
    description: string;
    items: CreateAfterSalesItemInput[];
}

export interface AfterSalesRequestListOptions {
    skip?: number | null;
    take?: number | null;
    state?: AfterSalesState | null;
}

export interface TransitionAfterSalesRequestInput {
    id: ID;
    state: Extract<AfterSalesState, 'APPROVED' | 'REJECTED' | 'COMPLETED'>;
    resolution: string;
    approvedAmount?: number | null;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        deliveryEmail?: string | null;
    }

    interface CustomProductVariantFields {
        fulfillmentType: FulfillmentType;
    }

    interface CustomOrderLineFields {
        fulfillmentTypeSnapshot: FulfillmentType;
    }
}
