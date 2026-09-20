import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import {
    AdministratorAccessService,
    CreateManagedAdministratorInput,
    ManagedRoleInput,
    UpdateManagedAdministratorInput,
} from './administrator-access.service';
import { AdministratorPermissionAuditService } from './administrator-permission-audit.service';
import { managePlatformTeamPermission, manageStoreTeamPermission } from './constants';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { PermissionPolicyRegistry } from './permission-policy';

@Resolver()
export class AdministratorAccessResolver {
    constructor(
        private readonly accessService: AdministratorAccessService,
        private readonly policies: PermissionPolicyRegistry,
        private readonly passwords: MerchantInitialPasswordService,
        private readonly permissionAudit: AdministratorPermissionAuditService,
    ) {}

    @Query()
    @Allow(Permission.Authenticated)
    myAdministratorAccess(@Ctx() ctx: RequestContext) {
        return this.accessService.current(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    manageableAdministrators(@Ctx() ctx: RequestContext) {
        return this.accessService.manageableAdministrators(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    manageableRoles(@Ctx() ctx: RequestContext) {
        return this.accessService.manageableRoles(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    manageableChannels(@Ctx() ctx: RequestContext) {
        return this.accessService.manageableChannels(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    permissionPolicyCatalog() {
        return { permissions: this.policies.catalog(), templates: this.policies.templates() };
    }

    @Query()
    @Allow(managePlatformTeamPermission.Permission, Permission.SuperAdmin)
    administratorPermissionAudits(@Ctx() ctx: RequestContext) {
        return this.permissionAudit.findVisible(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(
        manageStoreTeamPermission.Permission,
        managePlatformTeamPermission.Permission,
        Permission.SuperAdmin,
    )
    createManagedAdministrator(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateManagedAdministratorInput,
    ) {
        return this.accessService.createManagedAdministrator(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(
        manageStoreTeamPermission.Permission,
        managePlatformTeamPermission.Permission,
        Permission.SuperAdmin,
    )
    updateManagedAdministrator(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateManagedAdministratorInput,
    ) {
        return this.accessService.updateManagedAdministrator(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(
        manageStoreTeamPermission.Permission,
        managePlatformTeamPermission.Permission,
        Permission.SuperAdmin,
    )
    suspendManagedAdministrator(
        @Ctx() ctx: RequestContext,
        @Args('administratorId') administratorId: string,
    ) {
        return this.accessService.suspendManagedAdministrator(ctx, administratorId);
    }

    @Transaction()
    @Mutation()
    @Allow(
        manageStoreTeamPermission.Permission,
        managePlatformTeamPermission.Permission,
        Permission.SuperAdmin,
    )
    createManagedRole(@Ctx() ctx: RequestContext, @Args('input') input: ManagedRoleInput) {
        return this.accessService.createManagedRole(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(
        manageStoreTeamPermission.Permission,
        managePlatformTeamPermission.Permission,
        Permission.SuperAdmin,
    )
    updateManagedRole(@Ctx() ctx: RequestContext, @Args('input') input: ManagedRoleInput & { id: string }) {
        return this.accessService.updateManagedRole(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    async transferPlatformOwnership(
        @Ctx() ctx: RequestContext,
        @Args('targetAdministratorId') targetAdministratorId: string,
        @Args('currentPassword') currentPassword: string,
    ) {
        await this.passwords.assertCurrentPassword(ctx, currentPassword);
        return this.accessService.transferPlatformOwnership(ctx, targetAdministratorId);
    }

    @Transaction()
    @Mutation()
    @Allow(
        manageStoreTeamPermission.Permission,
        managePlatformTeamPermission.Permission,
        Permission.SuperAdmin,
    )
    async transferStoreAdministration(
        @Ctx() ctx: RequestContext,
        @Args('channelId') channelId: string,
        @Args('targetAdministratorId') targetAdministratorId: string,
        @Args('currentPassword') currentPassword: string,
    ) {
        await this.passwords.assertCurrentPassword(ctx, currentPassword);
        return this.accessService.transferStoreAdministration(ctx, channelId, targetAdministratorId);
    }
}
