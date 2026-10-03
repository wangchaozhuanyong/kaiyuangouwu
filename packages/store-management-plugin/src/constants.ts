import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    API_KEY_AUTH_STRATEGY_NAME,
    CrudPermissionDefinition,
    PermissionDefinition,
    RequestContext,
} from '@vendure/core';

const machineMailboxPermissions: ReadonlyMap<string, Permission> = new Map([
    ...[
        'Query.icloudPrimaryAccounts',
        'Query.icloudPrimaryAccount',
        'Query.icloudVirtualEmails',
        'Query.icloudVirtualEmail',
        'Query.icloudReceivedMails',
    ].map(field => [field, 'ReadIcloudRelay' as Permission] as const),
    ...[
        'Mutation.createIcloudPrimaryAccount',
        'Mutation.createIcloudVirtualEmail',
        'Mutation.batchCreateIcloudVirtualEmails',
    ].map(field => [field, 'CreateIcloudRelay' as Permission] as const),
    ...[
        'Mutation.reconcileIcloudMailHistory',
        'Mutation.updateIcloudPrimaryAccount',
        'Mutation.testIcloudConnection',
        'Mutation.syncIcloudAccount',
        'Mutation.resetIcloudMasterCode',
        'Mutation.updateIcloudVirtualEmail',
        'Mutation.resetIcloudVirtualEmailCode',
        'Mutation.reassignIcloudMail',
    ].map(field => [field, 'UpdateIcloudRelay' as Permission] as const),
    ...[
        'Mutation.deleteIcloudPrimaryAccount',
        'Mutation.deleteIcloudVirtualEmail',
        'Mutation.deleteIcloudMail',
    ].map(field => [field, 'DeleteIcloudRelay' as Permission] as const),
]);

// Machine users have no employee profile. Both governance gates must preserve
// the platform channel and the resolver's permission for this exact root field.
export function hasMachineMailboxAccess(ctx: RequestContext, rootField: string): boolean {
    const permission = machineMailboxPermissions.get(rootField);
    return (
        ctx.apiType === 'admin' &&
        !!ctx.activeUserId &&
        ctx.session?.authenticationStrategy === API_KEY_AUTH_STRATEGY_NAME &&
        ctx.channel.code === DEFAULT_CHANNEL_CODE &&
        permission !== undefined &&
        ctx.userHasPermissions([permission])
    );
}

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

export const managePlatformCatalogPermission = new PermissionDefinition({
    name: 'ManagePlatformCatalog',
    description:
        'Govern resource ownership and authorize sales in operating stores from the platform channel',
});
