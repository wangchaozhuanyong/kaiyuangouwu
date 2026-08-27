import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { RegisterCustomerInput } from '@vendure/common/lib/generated-shop-types';
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction, UserInputError } from '@vendure/core';
import type { Response } from 'express';

import {
    adjustReferralBalancePermission,
    manageReferralWithdrawalPermission,
    referralPermission,
    ReferralWithdrawalStatus,
    referralWithdrawalStatuses,
} from './referral.constants';
import {
    CreateReferralWithdrawalInput,
    ProcessReferralWithdrawalInput,
    ReferralService,
    SaveReferralPosterTemplateInput,
    UpdateReferralPosterTemplateInput,
    UpdateReferralProgramInput,
} from './referral.service';

@Resolver()
export class ReferralShopResolver {
    constructor(private readonly referralService: ReferralService) {}

    @Query()
    @Allow(Permission.Public)
    referralProgram(@Ctx() ctx: RequestContext) {
        return this.referralService.publicProgram(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    validateReferralInviteCode(@Ctx() ctx: RequestContext, @Args('code') code: string) {
        return this.referralService.validateInviteCode(ctx, code);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myReferralOverview(@Ctx() ctx: RequestContext) {
        return this.referralService.myOverview(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Public)
    registerCustomerWithReferral(
        @Ctx() ctx: RequestContext,
        @Args('input') input: RegisterCustomerInput,
        @Args('inviteCode') inviteCode?: string,
        @Args('source') source?: string,
    ) {
        return this.referralService.registerCustomerWithReferral(ctx, input, inviteCode, source);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    useMyReferralBalance(@Ctx() ctx: RequestContext, @Args('amount') amount: number) {
        return this.referralService.useBalance(ctx, amount);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Public)
    async recordStorefrontVisit(
        @Ctx() ctx: RequestContext,
        @Context('res') res: Response,
        @Args('visitorId') visitorId?: string,
    ) {
        const result = await this.referralService.recordVisit(ctx, visitorId);
        if (result.setCookie) res.append('Set-Cookie', result.setCookie);
        return { recorded: result.recorded };
    }
}

@Resolver()
export class ReferralAdminResolver {
    constructor(private readonly referralService: ReferralService) {}

    @Query()
    @Allow(referralPermission.Read)
    referralProgram(@Ctx() ctx: RequestContext) {
        return this.referralService.adminProgram(ctx);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralRelationships(
        @Ctx() ctx: RequestContext,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.referralService.adminRelationships(ctx, skip, take);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralInviterSummaries(
        @Ctx() ctx: RequestContext,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.referralService.adminInviterSummaries(ctx, skip, take);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralLedger(@Ctx() ctx: RequestContext, @Args('skip') skip?: number, @Args('take') take?: number) {
        return this.referralService.adminLedger(ctx, skip, take);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralRewards(@Ctx() ctx: RequestContext, @Args('skip') skip?: number, @Args('take') take?: number) {
        return this.referralService.adminRewards(ctx, skip, take);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralTodayMetrics(@Ctx() ctx: RequestContext) {
        return this.referralService.todayMetrics(ctx);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralBalanceAudit(@Ctx() ctx: RequestContext) {
        return this.referralService.balanceAudit(ctx);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralWithdrawals(
        @Ctx() ctx: RequestContext,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.referralService.adminWithdrawals(ctx, skip, take);
    }

    @Query()
    @Allow(referralPermission.Read)
    referralCustomerWallets(@Ctx() ctx: RequestContext, @Args('customerId') customerId: ID) {
        return this.referralService.adminCustomerWallets(ctx, customerId);
    }

    @Transaction()
    @Mutation()
    @Allow(referralPermission.Update)
    updateReferralProgram(@Ctx() ctx: RequestContext, @Args('input') input: UpdateReferralProgramInput) {
        return this.referralService.updateProgram(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(referralPermission.Create)
    createReferralPosterTemplate(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SaveReferralPosterTemplateInput,
    ) {
        return this.referralService.createPosterTemplate(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(referralPermission.Update)
    updateReferralPosterTemplate(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateReferralPosterTemplateInput,
    ) {
        return this.referralService.updatePosterTemplate(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(referralPermission.Delete)
    deleteReferralPosterTemplate(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.referralService.deletePosterTemplate(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(manageReferralWithdrawalPermission.Permission)
    createReferralWithdrawal(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateReferralWithdrawalInput,
    ) {
        return this.referralService.createWithdrawal(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(manageReferralWithdrawalPermission.Permission)
    processReferralWithdrawal(
        @Ctx() ctx: RequestContext,
        @Args('input') input: Omit<ProcessReferralWithdrawalInput, 'status'> & { status: string },
    ) {
        if (!referralWithdrawalStatuses.includes(input.status as ReferralWithdrawalStatus)) {
            throw new UserInputError('提款状态无效');
        }
        return this.referralService.processWithdrawal(ctx, {
            ...input,
            status: input.status as ReferralWithdrawalStatus,
        });
    }

    @Transaction()
    @Mutation()
    @Allow(adjustReferralBalancePermission.Permission)
    adjustReferralBalance(
        @Ctx() ctx: RequestContext,
        @Args('customerId') customerId: ID,
        @Args('currencyCode') currencyCode: CurrencyCode,
        @Args('amount') amount: number,
        @Args('reason') reason: string,
    ) {
        return this.referralService.adjustBalance(ctx, customerId, currencyCode, amount, reason);
    }
}
