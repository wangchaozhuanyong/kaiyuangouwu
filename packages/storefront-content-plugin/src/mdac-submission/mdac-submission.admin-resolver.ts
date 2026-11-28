import type { MdacSubmissionStatus } from './mdac-submission.types';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, UserInputError } from '@vendure/core';

import { storefrontContentPermission } from '../constants';

import { MdacSubmissionAdminView, MdacSubmissionService } from './mdac-submission.service';

@Resolver()
export class MdacSubmissionAdminResolver {
    constructor(private readonly submissions: MdacSubmissionService) {}

    @Query()
    @Allow(storefrontContentPermission.Read)
    mdacSubmissions(
        @Args('status') status?: MdacSubmissionStatus,
        @Args('limit') limit?: number,
    ): Promise<{ items: MdacSubmissionAdminView[]; totalItems: number }> {
        return this.submissions.adminList({ status, limit });
    }

    @Mutation()
    @Allow(storefrontContentPermission.Update)
    async retryMdacSubmission(@Args('id') id: string): Promise<MdacSubmissionAdminView> {
        const record = await this.submissions.retry(id);
        if (!record) throw new UserInputError('该任务不处于可重提状态');
        return record;
    }

    @Mutation()
    @Allow(storefrontContentPermission.Update)
    async cancelMdacSubmission(@Args('id') id: string): Promise<MdacSubmissionAdminView> {
        const record = await this.submissions.cancel(id);
        if (!record) throw new UserInputError('该任务已完成或不存在，不能终止');
        return record;
    }
}
