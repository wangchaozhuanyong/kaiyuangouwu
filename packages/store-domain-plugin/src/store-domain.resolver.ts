import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { StoreDomain } from './entities/store-domain.entity';
import { StoreDomainService } from './store-domain.service';

@Resolver(() => StoreDomain)
export class StoreDomainEntityResolver {
    constructor(private readonly storeDomainService: StoreDomainService) {}

    @ResolveField()
    verificationRecordName(@Parent() domain: StoreDomain): string {
        return this.storeDomainService.getVerificationRecordName(domain);
    }

    @ResolveField()
    verificationRecordValue(@Parent() domain: StoreDomain): string {
        return this.storeDomainService.getVerificationRecordValue(domain);
    }
}

@Resolver()
export class StoreDomainAdminResolver {
    constructor(private readonly storeDomainService: StoreDomainService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadChannel)
    storeDomains(@Ctx() ctx: RequestContext, @Args('channelId') channelId: ID) {
        return this.storeDomainService.findAll(ctx, channelId);
    }

    @Query()
    @Allow(Permission.Authenticated)
    storeDomainConfiguration() {
        return this.storeDomainService.configuration();
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.UpdateChannel)
    createStoreDomain(
        @Ctx() ctx: RequestContext,
        @Args('input') input: { channelId: ID; domain: string; isPrimary?: boolean | null },
    ) {
        return this.storeDomainService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.UpdateChannel)
    verifyStoreDomain(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.storeDomainService.verify(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.UpdateChannel)
    setPrimaryStoreDomain(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.storeDomainService.setPrimary(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.UpdateChannel)
    deleteStoreDomain(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.storeDomainService.delete(ctx, id);
    }
}
