import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';

import { type StorefrontSeoIdentity } from './storefront-seo.contract';
import {
    StorefrontSeoService,
    type PublishStorefrontSeoRecordInput,
    type RestoreStorefrontSeoRevisionInput,
    type SaveStorefrontSeoDraftInput,
} from './storefront-seo.service';

const readPermissions = [
    storefrontContentPermission.Read,
    Permission.ReadProduct,
    Permission.ReadCatalog,
    Permission.ReadCollection,
];
const writePermissions = [
    storefrontContentPermission.Update,
    Permission.UpdateProduct,
    Permission.UpdateCatalog,
    Permission.UpdateCollection,
];

@Resolver()
export class StorefrontSeoAdminResolver {
    constructor(private readonly service: StorefrontSeoService) {}

    @Query()
    @Allow(storefrontContentPermission.Read)
    storefrontSeoWorkspace(@Ctx() ctx: RequestContext) {
        return this.service.workspace(ctx);
    }

    @Query()
    @Allow(...readPermissions)
    storefrontSeoRecord(@Ctx() ctx: RequestContext, @Args('input') input: StorefrontSeoIdentity) {
        return this.service.getRecord(ctx, input);
    }

    @Query()
    @Allow(...readPermissions)
    storefrontSeoHistory(@Ctx() ctx: RequestContext, @Args('input') input: StorefrontSeoIdentity) {
        return this.service.history(ctx, input);
    }

    @Mutation()
    @Allow(...writePermissions)
    saveStorefrontSeoDraft(@Ctx() ctx: RequestContext, @Args('input') input: SaveStorefrontSeoDraftInput) {
        return this.service.saveDraft(ctx, input);
    }

    @Mutation()
    @Allow(...writePermissions)
    publishStorefrontSeoRecord(
        @Ctx() ctx: RequestContext,
        @Args('input') input: PublishStorefrontSeoRecordInput,
    ) {
        return this.service.publish(ctx, input);
    }

    @Mutation()
    @Allow(...writePermissions)
    unpublishStorefrontSeoRecord(
        @Ctx() ctx: RequestContext,
        @Args('input') input: PublishStorefrontSeoRecordInput,
    ) {
        return this.service.unpublish(ctx, input);
    }

    @Mutation()
    @Allow(...writePermissions)
    restoreStorefrontSeoRevision(
        @Ctx() ctx: RequestContext,
        @Args('input') input: RestoreStorefrontSeoRevisionInput,
    ) {
        return this.service.restoreRevision(ctx, input);
    }
}
