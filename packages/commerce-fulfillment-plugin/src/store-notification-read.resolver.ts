import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { StoreNotificationReadService, StoreNotificationReference } from './store-notification-read.service';

@Resolver()
export class StoreNotificationReadResolver {
    constructor(private readonly service: StoreNotificationReadService) {}

    @Query()
    @Allow(Permission.Authenticated)
    myStoreNotificationReadKeys(
        @Ctx() ctx: RequestContext,
        @Args('references') references: StoreNotificationReference[],
    ) {
        return this.service.readKeys(ctx, references);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    markMyStoreNotificationsRead(
        @Ctx() ctx: RequestContext,
        @Args('references') references: StoreNotificationReference[],
    ) {
        return this.service.markRead(ctx, references);
    }
}
