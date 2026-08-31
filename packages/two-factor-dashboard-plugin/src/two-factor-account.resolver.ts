import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { DashboardTwoFactorAccountInput, TwoFactorAccountService } from './two-factor-account.service';

@Resolver()
export class TwoFactorAccountResolver {
    constructor(private readonly accountService: TwoFactorAccountService) {}

    @Query()
    @Allow(Permission.Authenticated)
    dashboardTwoFactorAccounts(@Ctx() ctx: RequestContext) {
        return this.accountService.findAll(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    createDashboardTwoFactorAccount(
        @Ctx() ctx: RequestContext,
        @Args('input') input: DashboardTwoFactorAccountInput,
    ) {
        return this.accountService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    updateDashboardTwoFactorAccount(
        @Ctx() ctx: RequestContext,
        @Args('input') input: DashboardTwoFactorAccountInput & { id: ID },
    ) {
        return this.accountService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    importDashboardTwoFactorAccounts(
        @Ctx() ctx: RequestContext,
        @Args('inputs') inputs: DashboardTwoFactorAccountInput[],
    ) {
        return this.accountService.import(ctx, inputs);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    deleteDashboardTwoFactorAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.accountService.delete(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    clearDashboardTwoFactorAccounts(@Ctx() ctx: RequestContext) {
        return this.accountService.clear(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    touchDashboardTwoFactorAccount(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.accountService.touch(ctx, id);
    }
}
