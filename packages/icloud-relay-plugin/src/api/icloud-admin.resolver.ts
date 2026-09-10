import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { IcloudAdminService } from '../services/icloud-admin.service';
import {
    BatchCreateVirtualEmailsInput,
    CreatePrimaryAccountInput,
    CreateVirtualEmailInput,
    UpdatePrimaryAccountInput,
    UpdateVirtualEmailInput,
} from '../types';

@Resolver()
export class IcloudAdminResolver {
    constructor(private readonly adminService: IcloudAdminService) {}

    // ==========================================
    // Primary Account Queries
    // ==========================================

    @Query()
    @Allow(Permission.SuperAdmin)
    icloudPrimaryAccounts(@Ctx() ctx: RequestContext) {
        return this.adminService.findAllPrimaryAccounts(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    icloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.findPrimaryAccountById(ctx, id);
    }

    // ==========================================
    // Virtual Email Queries
    // ==========================================

    @Query()
    @Allow(Permission.SuperAdmin)
    icloudVirtualEmails(@Ctx() ctx: RequestContext, @Args('primaryAccountId') primaryAccountId?: ID) {
        return this.adminService.findAllVirtualEmails(ctx, primaryAccountId);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    icloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.findVirtualEmailById(ctx, id);
    }

    // ==========================================
    // Received Mail Queries
    // ==========================================

    @Query()
    @Allow(Permission.SuperAdmin)
    icloudReceivedMails(
        @Ctx() ctx: RequestContext,
        @Args('virtualEmailId') virtualEmailId?: ID,
        @Args('primaryAccountId') primaryAccountId?: ID,
        @Args('unassignedOnly') unassignedOnly?: boolean,
        @Args('limit') limit?: number,
    ) {
        return this.adminService.findReceivedMails(ctx, {
            virtualEmailId,
            primaryAccountId,
            unassignedOnly,
            limit,
        });
    }

    // ==========================================
    // Primary Account Mutations
    // ==========================================

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createIcloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('input') input: CreatePrimaryAccountInput) {
        return this.adminService.createPrimaryAccount(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateIcloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('input') input: UpdatePrimaryAccountInput) {
        return this.adminService.updatePrimaryAccount(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteIcloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.deletePrimaryAccount(ctx, id);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    testIcloudConnection(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.testConnection(ctx, id);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    syncIcloudAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.syncPrimaryAccount(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    resetIcloudMasterCode(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.resetMasterCode(ctx, id);
    }

    // ==========================================
    // Virtual Email Mutations
    // ==========================================

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createIcloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('input') input: CreateVirtualEmailInput) {
        return this.adminService.createVirtualEmail(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    batchCreateIcloudVirtualEmails(
        @Ctx() ctx: RequestContext,
        @Args('input') input: BatchCreateVirtualEmailsInput,
    ) {
        return this.adminService.batchCreateVirtualEmails(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateIcloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('input') input: UpdateVirtualEmailInput) {
        return this.adminService.updateVirtualEmail(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteIcloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.deleteVirtualEmail(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    resetIcloudVirtualEmailCode(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.resetVirtualEmailCode(ctx, id);
    }

    // ==========================================
    // Received Mail Mutations
    // ==========================================

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    reassignIcloudMail(
        @Ctx() ctx: RequestContext,
        @Args('mailId') mailId: ID,
        @Args('virtualEmailId') virtualEmailId: ID,
    ) {
        return this.adminService.reassignMail(ctx, mailId, virtualEmailId);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteIcloudMail(@Ctx() ctx: RequestContext, @Args('mailId') mailId: ID) {
        return this.adminService.deleteMail(ctx, mailId);
    }
}
