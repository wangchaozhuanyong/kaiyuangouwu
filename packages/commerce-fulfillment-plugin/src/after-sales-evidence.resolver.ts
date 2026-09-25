import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { EvidenceUpload } from './after-sales-evidence-storage.service';
import { AfterSalesEvidenceService } from './after-sales-evidence.service';
import { AfterSalesRequest } from './entities/after-sales-request.entity';

@Resolver()
export class AfterSalesEvidenceShopResolver {
    constructor(private readonly evidence: AfterSalesEvidenceService) {}

    @Mutation()
    @Allow(Permission.Authenticated)
    uploadAfterSalesEvidence(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('file') file: Promise<EvidenceUpload>,
    ) {
        return this.evidence.upload(ctx, orderId, file);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    removeMyAfterSalesEvidenceDraft(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.evidence.removeDraft(ctx, id);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myAfterSalesEvidenceDrafts(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.evidence.drafts(ctx, orderId);
    }
}

@Resolver('AfterSalesRequest')
export class AfterSalesEvidenceFieldResolver {
    constructor(private readonly evidenceService: AfterSalesEvidenceService) {}

    @ResolveField()
    evidence(@Ctx() ctx: RequestContext, @Parent() request: AfterSalesRequest) {
        return this.evidenceService.forRequest(ctx, request.id);
    }
}
