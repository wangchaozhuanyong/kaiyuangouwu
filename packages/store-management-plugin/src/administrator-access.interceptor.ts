import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    API_KEY_AUTH_STRATEGY_NAME,
    internal_getRequestContext,
    parseContext,
    UserInputError,
} from '@vendure/core';
import { catchError } from 'rxjs';

import { AdministratorAccessService } from './administrator-access.service';
import { AdministratorPermissionAuditService } from './administrator-permission-audit.service';

const allowedForSuspendedAccount = new Set(['Mutation.logout']);
const legacyTeamMutations = new Set([
    'Mutation.createAdministrator',
    'Mutation.updateAdministrator',
    'Mutation.assignRoleToAdministrator',
    'Mutation.deleteAdministrator',
    'Mutation.deleteAdministrators',
    'Mutation.createRole',
    'Mutation.updateRole',
    'Mutation.deleteRole',
    'Mutation.deleteRoles',
]);
const unscopedStoreTeamQueries = new Set([
    'Query.administrator',
    'Query.administrators',
    'Query.role',
    'Query.roles',
]);
const auditedMutations = new Set([
    'createManagedAdministrator',
    'updateManagedAdministrator',
    'suspendManagedAdministrator',
    'createManagedRole',
    'createMailboxIntegrationRole',
    'updateManagedRole',
    'transferPlatformOwnership',
    'transferStoreAdministration',
    'submitStoreGovernanceChange',
    'reviewStoreGovernanceChange',
]);
const machineMailboxPermissions = new Map<string, Permission>([
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

@Injectable()
export class AdministratorAccessInterceptor implements NestInterceptor {
    constructor(
        private readonly accessService: AdministratorAccessService,
        private readonly audit: AdministratorPermissionAuditService,
    ) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL) return next.handle();
        const requestContext = internal_getRequestContext(parsed.req, context);
        if (requestContext.apiType !== 'admin' || !requestContext.activeUserId) return next.handle();
        const rootField = `${parsed.info.parentType.name}.${parsed.info.fieldName}`;
        if (allowedForSuspendedAccount.has(rootField)) return next.handle();
        const mailboxPermission = machineMailboxPermissions.get(rootField);
        if (
            requestContext.session?.authenticationStrategy === API_KEY_AUTH_STRATEGY_NAME &&
            requestContext.channel.code === DEFAULT_CHANNEL_CODE &&
            mailboxPermission &&
            requestContext.userHasPermissions([mailboxPermission])
        ) {
            // Machine users have no Administrator profile. The resolver's @Allow check
            // still enforces the mailbox permission for this exact field.
            return next.handle();
        }
        const profile = await this.accessService.current(requestContext);
        if (profile.status === 'SUSPENDED') {
            throw new UserInputError('当前管理账号已被停用，请联系上级管理员');
        }
        if (legacyTeamMutations.has(rootField)) {
            await this.audit.record(requestContext, {
                action: 'REJECT_LEGACY_TEAM_MUTATION',
                channelId: profile.channelId,
                result: 'FAILED',
                failureReason: 'LEGACY_TEAM_ENDPOINT_DISABLED',
            });
            throw new UserInputError('管理员与岗位权限必须通过受限管理接口操作');
        }
        if (profile.scope === 'STORE' && unscopedStoreTeamQueries.has(rootField)) {
            throw new UserInputError('店铺账号请使用本店团队与岗位列表');
        }
        if (parsed.info.parentType.name !== 'Mutation' || !auditedMutations.has(parsed.info.fieldName)) {
            return next.handle();
        }
        const args = GqlExecutionContext.create(context).getArgs<Record<string, unknown>>();
        return next.handle().pipe(
            catchError(async error => {
                // The transactional resolver has already rolled back. Persist the failed attempt
                // on the original, non-transactional context without recording free-text input.
                await this.audit.record(requestContext, {
                    action: parsed.info.fieldName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
                    channelId: profile.channelId,
                    targetAdministratorId: targetAdministratorId(parsed.info.fieldName, args),
                    targetRoleId: targetRoleId(parsed.info.fieldName, args),
                    result: 'FAILED',
                    failureReason: safeFailureReason(error),
                });
                throw error;
            }),
        );
    }
}

function inputRecord(args: Record<string, unknown>): Record<string, unknown> {
    return args.input && typeof args.input === 'object' && !Array.isArray(args.input)
        ? (args.input as Record<string, unknown>)
        : {};
}

function id(value: unknown): string | null {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function targetAdministratorId(field: string, args: Record<string, unknown>): string | null {
    if (field === 'updateManagedAdministrator') return id(inputRecord(args).id);
    if (field === 'suspendManagedAdministrator') return id(args.administratorId);
    if (field.startsWith('transfer')) return id(args.targetAdministratorId);
    return null;
}

function targetRoleId(field: string, args: Record<string, unknown>): string | null {
    return field === 'updateManagedRole' ? id(inputRecord(args).id) : null;
}

function safeFailureReason(error: unknown): string {
    if (!error || typeof error !== 'object') return 'UNKNOWN_ERROR';
    const code = (error as { errorCode?: unknown }).errorCode;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(code)) return code;
    return error instanceof UserInputError ? 'INVALID_INPUT' : 'OPERATION_FAILED';
}
