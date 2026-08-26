import { CrudPermissionDefinition, PermissionDefinition } from '@vendure/core';

export const referralPermission = new CrudPermissionDefinition(
    'Referral',
    operation => `${operation} invitation relationships, reward balances, reports, and settings`,
);

export const manageReferralWithdrawalPermission = new PermissionDefinition({
    name: 'ManageReferralWithdrawal',
    description: 'Create, approve, reject, cancel, and complete manual referral withdrawals',
});

export const adjustReferralBalancePermission = new PermissionDefinition({
    name: 'AdjustReferralBalance',
    description: 'Apply an audited manual adjustment to a customer referral balance',
});

export const REFERRAL_BALANCE_PAYMENT_METHOD_CODE = 'referral-balance';
export const REFERRAL_BALANCE_PAYMENT_HANDLER_CODE = 'referral-balance-payment';

export const referralPosterTemplates = [
    'BRAND_MINIMAL',
    'BENEFIT_RED_GOLD',
    'PRODUCT_STORY',
    'PREMIUM_DARK',
] as const;

export type ReferralPosterTemplate = (typeof referralPosterTemplates)[number];

export const referralWithdrawalStatuses = ['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'] as const;

export type ReferralWithdrawalStatus = (typeof referralWithdrawalStatuses)[number];
