export const afterSalesTypes = ['REFUND_ONLY', 'RETURN_AND_REFUND', 'EXCHANGE', 'RESHIP'] as const;
export type AfterSalesType = (typeof afterSalesTypes)[number];

export const afterSalesStates = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const;
export type AfterSalesState = (typeof afterSalesStates)[number];

export const afterSalesEligibleOrderStates = [
    'PaymentSettled',
    'PartiallyShipped',
    'Shipped',
    'PartiallyDelivered',
    'Delivered',
];

export const afterSalesReasons = [
    'CHANGED_MIND',
    'NOT_AS_DESCRIBED',
    'DAMAGED',
    'WRONG_ITEM',
    'DELIVERY_ISSUE',
    'DIGITAL_CONTENT_ISSUE',
    'OTHER',
] as const;
export type AfterSalesReason = (typeof afterSalesReasons)[number];

export const afterSalesActorTypes = ['CUSTOMER', 'ADMIN', 'SYSTEM'] as const;
export type AfterSalesActorType = (typeof afterSalesActorTypes)[number];

export const afterSalesReturnStatuses = [
    'NOT_REQUIRED',
    'AWAITING_SHIPMENT',
    'IN_TRANSIT',
    'RECEIVED',
    'INSPECTED',
] as const;
export type AfterSalesReturnStatus = (typeof afterSalesReturnStatuses)[number];

export const afterSalesReplacementStatuses = [
    'NOT_REQUIRED',
    'PENDING',
    'SHIPPED',
    'EXCEPTION',
    'DELIVERED',
] as const;
export type AfterSalesReplacementStatus = (typeof afterSalesReplacementStatuses)[number];

export const activeAfterSalesStates: AfterSalesState[] = ['PENDING', 'APPROVED', 'COMPLETED'];
