import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';

import { SystemAnnouncementService } from './system-announcement.service';
import {
    CreateSystemAnnouncementInput,
    StorefrontAnnouncementPageOptions,
    UpdateSystemAnnouncementInput,
} from './types';

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
    @Allow(Permission.SuperAdmin, storefrontContentPermission.Read)
    systemAnnouncements(@Ctx() ctx: RequestContext) {
        return this.announcementService.findAll(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, storefrontContentPermission.Create)
    createSystemAnnouncement(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateSystemAnnouncementInput,
    ) {
        return this.announcementService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, storefrontContentPermission.Update)
    updateSystemAnnouncement(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateSystemAnnouncementInput,
    ) {
        return this.announcementService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, storefrontContentPermission.Delete)
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

    @Query()
    @Allow(Permission.Public)
    storefrontAnnouncements(
        @Ctx() ctx: RequestContext,
        @Args('options') options?: StorefrontAnnouncementPageOptions,
    ) {
        return this.announcementService.findActivePage(ctx, options);
    }

    @Query()
    @Allow(Permission.Public)
    storefrontAnnouncement(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.announcementService.findActiveById(ctx, id);
    }
}
