import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ID,
    Permission,
    RequestContext,
    ShippingMethodService,
    Transaction,
} from '@vendure/core';

/** Every store operation derives its target from ctx; no caller-supplied channel ID is accepted. */
@Resolver()
export class ShippingTemplateAdminResolver {
    constructor(private readonly shipping: ShippingMethodService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadShippingMethod)
    shippingTemplateManagement(@Ctx() ctx: RequestContext) {
        return this.shipping.getShippingTemplateManagement(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    initializePlatformShippingTemplates(@Ctx() ctx: RequestContext) {
        return this.shipping.initializePlatformShippingTemplates(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    createPlatformFreeShippingVersion(@Ctx() ctx: RequestContext) {
        return this.shipping.createPlatformFreeShippingVersion(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateShippingMethod)
    setMyShippingTemplateEnabled(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('enabled') enabled: boolean,
    ) {
        return this.shipping.setMyShippingTemplateEnabled(ctx, id, enabled);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings, Permission.CreateShippingMethod)
    copyPlatformShippingTemplate(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('name') name?: string,
    ) {
        return this.shipping.copyPlatformShippingTemplate(ctx, id, name);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    confirmLegacyShippingMethodOwnership(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('channelId') channelId: ID,
        @Args('sourceCurrencyCode') sourceCurrencyCode: string,
    ) {
        return this.shipping.confirmLegacyShippingMethodOwnership(ctx, id, channelId, sourceCurrencyCode);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings, Permission.CreateShippingMethod)
    copyLegacyShippingMethod(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('sourceCurrencyCode') sourceCurrencyCode: string,
        @Args('name') name?: string,
    ) {
        return this.shipping.copyLegacyShippingMethod(ctx, id, sourceCurrencyCode, name);
    }
}
