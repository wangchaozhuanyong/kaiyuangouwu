import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Collection,
    ForbiddenError,
    Permission,
    Product,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';

import { type StorefrontSeoIdentity } from './storefront-seo.contract';

export function canReadSeo(ctx: RequestContext, identity: StorefrontSeoIdentity): boolean {
    const permissions =
        identity.targetType === 'PRODUCT'
            ? [Permission.ReadProduct, Permission.ReadCatalog]
            : identity.targetType === 'COLLECTION'
              ? [Permission.ReadCollection, Permission.ReadCatalog]
              : [storefrontContentPermission.Read];
    return ctx.userHasPermissions([Permission.SuperAdmin, ...permissions]);
}
export function canWriteSeo(ctx: RequestContext, identity: StorefrontSeoIdentity): boolean {
    const permissions =
        identity.targetType === 'PRODUCT'
            ? [Permission.UpdateProduct, Permission.UpdateCatalog]
            : identity.targetType === 'COLLECTION'
              ? [Permission.UpdateCollection, Permission.UpdateCatalog]
              : [storefrontContentPermission.Update];
    return ctx.userHasPermissions([Permission.SuperAdmin, ...permissions]);
}
export function assertSeoAdmin(ctx: RequestContext, identity: StorefrontSeoIdentity, write = false): void {
    if (
        ctx.apiType !== 'admin' ||
        !ctx.activeUserId ||
        ctx.channel.code === DEFAULT_CHANNEL_CODE ||
        !(write ? canWriteSeo(ctx, identity) : canReadSeo(ctx, identity))
    )
        throw new ForbiddenError();
}
/** SEO is a store-local override; this never changes the underlying shared catalog entity. */
export async function seoEntityBelongsToChannel(
    connection: TransactionalConnection,
    ctx: RequestContext,
    identity: StorefrontSeoIdentity,
): Promise<boolean> {
    if (identity.targetType === 'PRODUCT') {
        const product = await connection.findOneInChannel(ctx, Product, identity.targetId, ctx.channelId);
        return Boolean(product && !product.deletedAt);
    }
    if (identity.targetType === 'COLLECTION') {
        return Boolean(await connection.findOneInChannel(ctx, Collection, identity.targetId, ctx.channelId));
    }
    return true;
}
