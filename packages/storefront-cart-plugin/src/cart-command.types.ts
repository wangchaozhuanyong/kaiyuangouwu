import { CreateAddressInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/core';

export interface CartChanges {
    add?: Array<{ productVariantId: ID; quantity: number }>;
    lines?: Array<{ lineId: ID; quantity?: number | null; selected?: boolean | null }>;
    remove?: ID[];
}

export interface CartCommandInput {
    commandId: string;
    cartId: ID;
    expectedRevision: number;
    changes?: CartChanges;
    buyNow?: { productVariantId: ID; quantity: number };
    prepareShipping?: {
        shippingAddress: CreateAddressInput;
        selectedShippingMethodId?: ID | null;
        preferredShippingCode?: string | null;
        defaultShippingCode?: string | null;
    };
    beginCheckout?: boolean;
    preparePayment?: boolean;
    reopen?: boolean;
    [operation: string]: unknown;
}

export type CartCommandStatus = 'APPLIED' | 'REJECTED' | 'CANCELLED' | 'NOT_FOUND';
