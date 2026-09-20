import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import {
    AppealFraudRiskCaseInput,
    FraudRiskCaseListOptions,
    FraudRiskService,
    ReviewFraudRiskCaseInput,
} from './fraud-risk.service';
import {
    GovernanceService,
    ReviewGovernanceApprovalInput,
    SubmitGovernedConfigInput,
} from './governance.service';

@Resolver()
export class GovernanceRiskAdminResolver {
    constructor(
        private readonly governance: GovernanceService,
        private readonly fraud: FraudRiskService,
    ) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    governanceApprovals(@Ctx() ctx: RequestContext, @Args('status', { nullable: true }) status?: string) {
        return this.governance.listApprovals(ctx, status);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    governedConfigVersions(
        @Ctx() ctx: RequestContext,
        @Args('namespace', { nullable: true }) namespace?: string,
    ) {
        return this.governance.listConfigVersions(ctx, namespace as never);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    governanceAuditEntries(
        @Ctx() ctx: RequestContext,
        @Args('skip', { nullable: true }) skip?: number,
        @Args('take', { nullable: true }) take?: number,
    ) {
        return this.governance.listAudit(ctx, skip, take);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    governanceAuditIntegrity(@Ctx() ctx: RequestContext) {
        return this.governance.verifyAuditChain(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    governanceReports(@Ctx() ctx: RequestContext) {
        return this.governance.listReports(ctx);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    fraudRiskCases(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options?: FraudRiskCaseListOptions,
    ) {
        return this.fraud.listCases(ctx, options);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    submitGovernedConfig(@Ctx() ctx: RequestContext, @Args('input') input: SubmitGovernedConfigInput) {
        return this.governance.submitConfig(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    reviewGovernanceApproval(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ReviewGovernanceApprovalInput,
    ) {
        return this.governance.reviewApproval(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    reviewFraudRiskCase(@Ctx() ctx: RequestContext, @Args('input') input: ReviewFraudRiskCaseInput) {
        return this.fraud.reviewCase(ctx, input);
    }
}

@Resolver()
export class GovernanceRiskShopResolver {
    constructor(private readonly fraud: FraudRiskService) {}

    @Query()
    @Allow(Permission.Authenticated)
    myFraudRiskCases(@Ctx() ctx: RequestContext) {
        return this.fraud.myCases(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    appealMyFraudRiskCase(@Ctx() ctx: RequestContext, @Args('input') input: AppealFraudRiskCaseInput) {
        return this.fraud.appealMine(ctx, input);
    }
}
