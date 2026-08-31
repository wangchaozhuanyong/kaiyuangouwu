import { ID } from '@vendure/common/lib/shared-types';
import {
    CustomChannelFields,
    CustomOrderFields,
    CustomOrderLineFields,
    CustomProductFields,
    CustomProductVariantFields,
} from '@vendure/core/dist/entity/custom-entity-fields';

import { AfterSalesReason, AfterSalesState, AfterSalesType } from './after-sales.constants';
import { AutoCardFieldDefinition } from './auto-card-format';
import { AutoCardDeliveryState, AutoCardPoolItemState, DigitalDeliveryMode } from './auto-card.constants';

export type FulfillmentType = 'physical' | 'digital';
export type StoreCommerceMode = 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';
export type RefundPolicy = 'MERCHANT_REVIEW' | 'SEVEN_DAY_NO_REASON' | 'NON_REFUNDABLE';
export type DigitalStockPolicy = 'pool_derived' | 'limited' | 'unlimited';

export interface UpdateProductPackagingInput {
    productId: ID;
    unitVariantId: ID;
    packageVariantId: ID;
    unitLabel: string;
    packageLabel: string;
    unitsPerPackage: number;
    enabled: boolean;
    autoUnpack: boolean;
}

export interface UpdateProductPackagingInput {
    productId: ID;
    unitVariantId: ID;
    packageVariantId: ID;
    unitLabel: string;
    packageLabel: string;
    unitsPerPackage: number;
    enabled: boolean;
    autoUnpack: boolean;
}

export interface UpdateAutoCardConfigInput {
    productVariantId: ID;
    enabled: boolean;
    formatName: string;
    delimiter: string;
    fields: AutoCardFieldDefinition[];
    instructions?: string | null;
    instructionsZh?: string | null;
    instructionsEn?: string | null;
    lowStockThreshold: number;
}

export interface AutoCardImportInput {
    productVariantId: ID;
    rawText: string;
}

export interface AutoCardPoolItemListOptions {
    skip?: number | null;
    take?: number | null;
    state?: AutoCardPoolItemState | null;
}

export interface AutoCardDeliveryListOptions {
    skip?: number | null;
    take?: number | null;
    state?: AutoCardDeliveryState | null;
    productVariantId?: ID | null;
    orderId?: ID | null;
}

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
    states?: AfterSalesState[] | null;
    search?: string | null;
}

export interface TransitionAfterSalesRequestInput {
    id: ID;
    state: Extract<AfterSalesState, 'APPROVED' | 'REJECTED' | 'COMPLETED'>;
    resolution: string;
    approvedAmount?: number | null;
    refundId?: ID | null;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomChannelFields {
        commerceMode: StoreCommerceMode;
    }

    interface CustomOrderFields {
        deliveryEmail?: string | null;
        deliveryEmailContactId?: string | null;
    }

    interface CustomProductFields {
        fulfillmentType: FulfillmentType;
        refundPolicy: RefundPolicy;
        manualDeliverySlaMinutes: number;
    }

    interface CustomProductVariantFields {
        fulfillmentType: FulfillmentType;
        digitalDeliveryMode: DigitalDeliveryMode;
        digitalStockPolicy: DigitalStockPolicy;
    }

    interface CustomOrderLineFields {
        fulfillmentTypeSnapshot: FulfillmentType;
        digitalDeliveryModeSnapshot: DigitalDeliveryMode;
        refundPolicySnapshot: RefundPolicy;
        manualDeliverySlaMinutesSnapshot: number;
    }
}
