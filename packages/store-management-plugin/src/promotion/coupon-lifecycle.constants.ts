export const customerCouponStatuses = [
    'AVAILABLE',
    'LOCKED',
    'USED',
    'RETURNED',
    'EXPIRED',
    'REVOKED',
] as const;

export type CustomerCouponStatus = (typeof customerCouponStatuses)[number];

export const couponStackPolicies = ['EXCLUSIVE', 'STACKABLE'] as const;

export type CouponStackPolicy = (typeof couponStackPolicies)[number];

export const couponLedgerEventTypes = [
    'CLAIMED',
    'LOCKED',
    'RELEASED',
    'REDEEMED',
    'RETURNED',
    'EXPIRED',
    'REVOKED',
    'REFUND_SETTLED',
] as const;

export type CouponLedgerEventType = (typeof couponLedgerEventTypes)[number];

export const couponAllocationStatuses = ['LOCKED', 'USED', 'RELEASED', 'REFUNDED'] as const;

export type CouponAllocationStatus = (typeof couponAllocationStatuses)[number];

export const couponLedgerActorTypes = ['CUSTOMER', 'ADMIN', 'SYSTEM'] as const;

export type CouponLedgerActorType = (typeof couponLedgerActorTypes)[number];

export const COUPON_LOCK_MINUTES = 30;

export const usableCustomerCouponStatuses: readonly CustomerCouponStatus[] = ['AVAILABLE', 'RETURNED'];
