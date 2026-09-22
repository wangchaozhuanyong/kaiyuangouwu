import { CrudPermissionDefinition, PermissionDefinition } from '@vendure/core';

export const storeProfilePermission = new CrudPermissionDefinition(
    'StoreProfile',
    operation => `${operation} the active sales channel store profile`,
);

export const manageStoreTeamPermission = new PermissionDefinition({
    name: 'ManageStoreTeam',
    description: 'Manage lower-level administrators and employees in the active store',
});

export const managePlatformTeamPermission = new PermissionDefinition({
    name: 'ManagePlatformTeam',
    description: 'Manage platform employees and store primary administrators',
});

export const manageStoreLifecyclePermission = new PermissionDefinition({
    name: 'ManageStoreLifecycle',
    description: 'Provision, activate, update, and suspend stores without permanently deprovisioning them',
});

export const reviewStoreGovernancePermission = new PermissionDefinition({
    name: 'ReviewStoreGovernance',
    description: 'Review legal identity, payout account, wallet, and payment configuration changes',
});

export const sensitiveStoreFinancePermission = new PermissionDefinition({
    name: 'SensitiveStoreFinance',
    description: 'Perform explicitly authorized sensitive store finance operations',
});

export const STOREFRONT_PROMOTION_OPTIONS = Symbol('STOREFRONT_PROMOTION_OPTIONS');
export const STOREFRONT_ENTRY_COOKIE = 'storefront-entry';
