import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext, Transaction } from '@vendure/core';

import { manageIcloudRelayPermission } from '../constants';
import { IcloudAdminService } from '../services/icloud-admin.service';
import { IcloudMailHistoryService } from '../services/icloud-mail-history.service';
import {
    BatchCreateVirtualEmailsInput,
    CreatePrimaryAccountInput,
    CreateVirtualEmailInput,
    UpdatePrimaryAccountInput,
    UpdateVirtualEmailInput,
} from '../types';

@Resolver()
export class IcloudAdminResolver {
    constructor(
        private readonly adminService: IcloudAdminService,
        private readonly mailHistory: IcloudMailHistoryService,
    ) {}

    @Mutation()
    @Allow(manageIcloudRelayPermission.Update)
    reconcileIcloudMailHistory(
        @Ctx() ctx: RequestContext,
        @Args('primaryAccountId') primaryAccountId: ID,
        @Args('dryRun') dryRun = true,
    ) {
        return this.mailHistory.reconcile(ctx, primaryAccountId, dryRun);
    }

    // ==========================================
    // Primary Account Queries
    // ==========================================

    @Query()
    @Allow(manageIcloudRelayPermission.Read)
    icloudPrimaryAccounts(@Ctx() ctx: RequestContext) {
        return this.adminService.findAllPrimaryAccounts(ctx);
    }

    @Query()
    @Allow(manageIcloudRelayPermission.Read)
    icloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.findPrimaryAccountById(ctx, id);
    }

    // ==========================================
    // Virtual Email Queries
    // ==========================================

    @Query()
    @Allow(manageIcloudRelayPermission.Read)
    icloudVirtualEmails(@Ctx() ctx: RequestContext, @Args('primaryAccountId') primaryAccountId?: ID) {
        return this.adminService.findAllVirtualEmails(ctx, primaryAccountId);
    }

    @Query()
    @Allow(manageIcloudRelayPermission.Read)
    icloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.findVirtualEmailById(ctx, id);
    }

    // ==========================================
    // Received Mail Queries
    // ==========================================

    @Query()
    @Allow(manageIcloudRelayPermission.Read)
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
    @Allow(manageIcloudRelayPermission.Create)
    createIcloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('input') input: CreatePrimaryAccountInput) {
        return this.adminService.createPrimaryAccount(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Update)
    updateIcloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('input') input: UpdatePrimaryAccountInput) {
        return this.adminService.updatePrimaryAccount(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Delete)
    deleteIcloudPrimaryAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.deletePrimaryAccount(ctx, id);
    }

    @Mutation()
    @Allow(manageIcloudRelayPermission.Update)
    testIcloudConnection(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.testConnection(ctx, id);
    }

    @Mutation()
    @Allow(manageIcloudRelayPermission.Update)
    syncIcloudAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.syncPrimaryAccount(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Update)
    resetIcloudMasterCode(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.resetMasterCode(ctx, id);
    }

    // ==========================================
    // Virtual Email Mutations
    // ==========================================

    @Mutation()
    @Allow(manageIcloudRelayPermission.Create)
    createIcloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('input') input: CreateVirtualEmailInput) {
        return this.adminService.createVirtualEmail(ctx, input);
    }

    @Mutation()
    @Allow(manageIcloudRelayPermission.Create)
    batchCreateIcloudVirtualEmails(
        @Ctx() ctx: RequestContext,
        @Args('input') input: BatchCreateVirtualEmailsInput,
    ) {
        return this.adminService.batchCreateVirtualEmails(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Update)
    updateIcloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('input') input: UpdateVirtualEmailInput) {
        return this.adminService.updateVirtualEmail(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Delete)
    deleteIcloudVirtualEmail(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.deleteVirtualEmail(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Update)
    resetIcloudVirtualEmailCode(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.adminService.resetVirtualEmailCode(ctx, id);
    }

    // ==========================================
    // Received Mail Mutations
    // ==========================================

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Update)
    reassignIcloudMail(
        @Ctx() ctx: RequestContext,
        @Args('mailId') mailId: ID,
        @Args('virtualEmailId') virtualEmailId: ID,
    ) {
        return this.adminService.reassignMail(ctx, mailId, virtualEmailId);
    }

    @Mutation()
    @Transaction()
    @Allow(manageIcloudRelayPermission.Delete)
    deleteIcloudMail(@Ctx() ctx: RequestContext, @Args('mailId') mailId: ID) {
        return this.adminService.deleteMail(ctx, mailId);
    }
}
