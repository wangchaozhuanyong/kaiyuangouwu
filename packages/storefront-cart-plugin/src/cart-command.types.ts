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
    beginCheckout?: boolean;
    preparePayment?: boolean;
    reopen?: boolean;
    [operation: string]: unknown;
}

export type CartCommandStatus = 'APPLIED' | 'REJECTED' | 'CANCELLED' | 'NOT_FOUND';
