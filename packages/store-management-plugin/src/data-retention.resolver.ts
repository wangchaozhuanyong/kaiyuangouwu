import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { DataRetentionService } from './data-retention.service';

@Resolver()
export class DataRetentionAdminResolver {
    constructor(private readonly dataRetention: DataRetentionService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    dataRetentionRecords(@Ctx() ctx: RequestContext) {
        return this.dataRetention.listRecords(ctx);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    setDataRetentionLegalHold(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('enabled') enabled: boolean,
        @Args('reason', { nullable: true }) reason?: string,
    ) {
        return this.dataRetention.setLegalHold(ctx, id, enabled, reason);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    retryDataRetentionRecord(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.dataRetention.retry(ctx, id);
    }
}
