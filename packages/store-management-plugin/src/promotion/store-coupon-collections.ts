import {
    Collection,
    ID,
    ProductVariant,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';

export async function couponCollectionsForVariant(
    ctx: RequestContext,
    variantId: ID,
    connection: TransactionalConnection,
    requestCache: RequestContextCacheService,
): Promise<string[]> {
    const variant = await requestCache.load(
        ctx,
        `coupon-variant-collections:${ctx.channelId}`,
        variantId,
        async ids => {
            const variants = await connection.getRepository(ctx, ProductVariant).find({
                where: { id: In([...ids]), channels: { id: ctx.channelId } },
                relations: { collections: true },
                loadEagerRelations: false,
            });
            const byId = new Map(variants.map(item => [String(item.id), item]));
            return ids.map(id => byId.get(id));
        },
    );
    if (!variant?.collections.length) return [];

    // Resolve the current hierarchy once per request, so new or moved descendants
    // are covered without rewriting campaigns or querying ancestors for every line.
    const parents = await requestCache.get(
        ctx,
        `store-coupon-collection-parents:${ctx.channelId}`,
        async () => {
            const collections = await connection.getRepository(ctx, Collection).find({
                select: { id: true, parentId: true },
                where: { channels: { id: ctx.channelId }, isRoot: false },
                loadEagerRelations: false,
            });
            return new Map(
                collections.map(collection => [String(collection.id), String(collection.parentId)]),
            );
        },
    );
    const result = new Set<string>();
    for (const collection of variant.collections) {
        let id: string | undefined = String(collection.id);
        const visited = new Set<string>();
        while (id && parents.has(id) && !visited.has(id)) {
            result.add(id);
            visited.add(id);
            id = parents.get(id);
        }
    }
    return [...result];
}
