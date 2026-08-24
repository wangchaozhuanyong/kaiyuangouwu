import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { SystemAnnouncementService } from './system-announcement.service';
import { CreateSystemAnnouncementInput, UpdateSystemAnnouncementInput } from './types';

@Resolver()
export class SystemAnnouncementAdminResolver {
    constructor(private readonly announcementService: SystemAnnouncementService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    systemAnnouncements(@Ctx() ctx: RequestContext) {
        return this.announcementService.findAll(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    createSystemAnnouncement(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateSystemAnnouncementInput,
    ) {
        return this.announcementService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    updateSystemAnnouncement(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateSystemAnnouncementInput,
    ) {
        return this.announcementService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    deleteSystemAnnouncement(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.announcementService.delete(ctx, id);
    }
}

@Resolver()
export class SystemAnnouncementShopResolver {
    constructor(private readonly announcementService: SystemAnnouncementService) {}

    @Query()
    @Allow(Permission.Public)
    activeSystemAnnouncements(@Ctx() ctx: RequestContext) {
        return this.announcementService.findActive(ctx);
    }
}
