import { Args, Info, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ForbiddenError,
    Permission,
    PluginCommonModule,
    RequestContext,
    UserInputError,
    VendurePlugin,
} from '@vendure/core';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { getArgumentValues, type GraphQLResolveInfo } from 'graphql';

import { ShopAbuseProtectionPlugin } from '../abuse-protection/plugin';
import { StorefrontClientPluginAccessService } from '../storefront-client-plugin-access.service';

import { adminSchema, shopSchema } from './api-extensions';
import { GptRechargeConfig, GptRechargeReceipt } from './entities';
import { GptRechargeService } from './service';

async function respond<T>(ctx: RequestContext, work: () => Promise<T>): Promise<T> {
    ctx.req?.res?.setHeader('Cache-Control', 'no-store');
    try {
        return await work();
    } catch (error) {
        if (error instanceof UserInputError || error instanceof ForbiddenError) throw error;
        throw new UserInputError('充值服务暂不可用，请稍后查询原兑换码');
    }
}

@Resolver()
export class GptRechargeShopResolver {
    constructor(private readonly service: GptRechargeService) {}
    @Query()
    @Allow(Permission.Public)
    gptRechargeConfig(@Ctx() ctx: RequestContext) {
        return respond(ctx, () => this.service.publicConfig(ctx));
    }
    @Query()
    @Allow(Permission.Public)
    gptRechargeTask(
        @Ctx() ctx: RequestContext,
        @Info() info: GraphQLResolveInfo,
        @Args('credential') credential: string,
    ) {
        return respond(ctx, () => {
            // The entity ID interceptor decodes the resolver args, but this ID is
            // an opaque receipt reference. Read the validated GraphQL argument.
            const { id } = getArgumentValues(
                info.parentType.getFields()[info.fieldName],
                info.fieldNodes[0],
                info.variableValues,
            );
            if (typeof id !== 'string') throw new ForbiddenError();
            return this.service.task(ctx, id, credential);
        });
    }
    @Mutation()
    @Allow(Permission.Public)
    verifyGptRechargeCode(@Ctx() ctx: RequestContext, @Args('code') code: string) {
        return respond(ctx, () => this.service.verify(ctx, code));
    }
    @Mutation()
    @Allow(Permission.Public)
    queryGptRechargeCode(@Ctx() ctx: RequestContext, @Args('code') code: string) {
        return respond(ctx, () => this.service.query(ctx, code));
    }
    @Mutation()
    @Allow(Permission.Public)
    submitGptRecharge(
        @Ctx() ctx: RequestContext,
        @Args('code') code: string,
        @Args('session') session: string,
    ) {
        return respond(ctx, () => this.service.submit(ctx, code, session));
    }
}
@Resolver()
export class GptRechargeAdminResolver {
    constructor(private readonly service: GptRechargeService) {}
    @Query()
    @Allow(Permission.SuperAdmin)
    gptRechargeAdminConfig(@Ctx() ctx: RequestContext) {
        return respond(ctx, () => this.service.adminConfig(ctx));
    }
    @Mutation()
    @Allow(Permission.SuperAdmin)
    updateGptRechargeConfig(
        @Ctx() ctx: RequestContext,
        @Args('input')
        input: { enabled: boolean; upstreamOrigin: string; serviceKey?: string; expectedRevision: number },
    ) {
        return respond(ctx, () => this.service.saveConfig(ctx, input));
    }
}

@VendurePlugin({
    imports: [PluginCommonModule, StorefrontContentPlugin, ShopAbuseProtectionPlugin],
    entities: [GptRechargeConfig, GptRechargeReceipt],
    providers: [GptRechargeService, StorefrontClientPluginAccessService],
    shopApiExtensions: { schema: shopSchema, resolvers: [GptRechargeShopResolver] },
    adminApiExtensions: { schema: adminSchema, resolvers: [GptRechargeAdminResolver] },
    compatibility: '^3.7.0',
})
export class GptRechargePlugin {}
