import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { SystemAnnouncementService } from './system-announcement.service';
import { CreateSystemAnnouncementInput, UpdateSystemAnnouncementInput } from './types';

@Resolver('SystemAnnouncement')
export class SystemAnnouncementAdminResolver {
    private readonly translationLockCache = new WeakMap<
        object,
        ReturnType<SystemAnnouncementService['translationLocks']>
    >();

    constructor(private readonly announcementService: SystemAnnouncementService) {}

    @ResolveField()
    async titleEnLocked(@Ctx() ctx: RequestContext, @Parent() announcement: { id: ID }) {
        return (await this.translationLocks(ctx, announcement)).titleEnLocked;
    }

    @ResolveField()
    async contentEnLocked(@Ctx() ctx: RequestContext, @Parent() announcement: { id: ID }) {
        return (await this.translationLocks(ctx, announcement)).contentEnLocked;
    }

    private translationLocks(ctx: RequestContext, announcement: { id: ID }) {
        let locks = this.translationLockCache.get(announcement);
        if (!locks) {
            locks = this.announcementService.translationLocks(ctx, announcement.id);
            this.translationLockCache.set(announcement, locks);
        }
        return locks;
    }

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
