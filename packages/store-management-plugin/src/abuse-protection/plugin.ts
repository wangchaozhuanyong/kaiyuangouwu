import { APP_INTERCEPTOR } from '@nestjs/core';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, PluginCommonModule, RequestContext, VendurePlugin } from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import gql from 'graphql-tag';

import { ShopAbuseBucket, ShopAbuseChallenge } from './entities';
import { ShopAbuseInterceptor } from './interceptor';
import { ShopAbuseProtectionService } from './service';
import { ShopAbuseStore } from './store';
import { pruneShopAbuseStateTask } from './tasks';

@Resolver()
export class ShopAbuseChallengeResolver {
    constructor(private readonly service: ShopAbuseProtectionService) {}
    @Mutation()
    @Allow(Permission.Public)
    createShopAbuseChallenge(
        @Ctx() ctx: RequestContext,
        @Args('action') action: string,
        @Args('target') target: string,
    ) {
        return this.service.challenge(ctx, action, target);
    }
}

@VendurePlugin({
    imports: [PluginCommonModule, OperationsDashboardPlugin],
    entities: [ShopAbuseBucket, ShopAbuseChallenge],
    providers: [
        ShopAbuseStore,
        ShopAbuseProtectionService,
        { provide: APP_INTERCEPTOR, useClass: ShopAbuseInterceptor },
    ],
    exports: [ShopAbuseProtectionService],
    shopApiExtensions: {
        schema: gql`
            type ShopAbuseChallengeResult {
                id: String!
                imageDataUrl: String!
                expiresAt: DateTime!
            }
            extend type Mutation {
                createShopAbuseChallenge(action: String!, target: String!): ShopAbuseChallengeResult!
            }
        `,
        resolvers: [ShopAbuseChallengeResolver],
    },
    compatibility: '^3.7.0',
    configuration: config => {
        config.schedulerOptions.tasks.push(pruneShopAbuseStateTask);
        return config;
    },
})
export class ShopAbuseProtectionPlugin {}
