import type { MdacSubmissionInput } from './mdac-submission.types';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { MdacSubmissionService, type MdacSubmissionView } from './mdac-submission.service';

@Resolver()
export class MdacSubmissionShopResolver {
    constructor(private readonly submissions: MdacSubmissionService) {}

    @Mutation()
    @Allow(Permission.Public)
    createMdacSubmission(
        @Ctx() ctx: RequestContext,
        @Args('input') input: MdacSubmissionInput,
    ): Promise<MdacSubmissionView> {
        return this.submissions.create(ctx, input);
    }

    @Query()
    @Allow(Permission.Public)
    mdacSubmission(
        @Ctx() ctx: RequestContext,
        @Args('id') id: string,
    ): Promise<MdacSubmissionView | undefined> {
        return this.submissions.find(ctx, id);
    }

    @Query()
    @Allow(Permission.Public)
    mdacSubmissionReceipt(
        @Ctx() ctx: RequestContext,
        @Args('id') id: string,
    ): Promise<{ fileName: string; mimeType: string; base64: string } | undefined> {
        return this.submissions.receipt(ctx, id);
    }
}
