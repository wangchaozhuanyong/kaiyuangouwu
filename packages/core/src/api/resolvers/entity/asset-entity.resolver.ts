import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { Asset } from '../../../entity/asset/asset.entity';
import { Tag } from '../../../entity/tag/tag.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { TagService } from '../../../service/services/tag.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Asset')
export class AssetEntityResolver {
    constructor(
        private readonly tagService: TagService,
        private readonly localeStringHydrator: LocaleStringHydrator,
        private readonly requestContextCache: RequestContextCacheService,
    ) {}

    @ResolveField()
    async name(@Ctx() ctx: RequestContext, @Parent() asset: Asset): Promise<string> {
        // Handle assets without translations (legacy data)
        if (!asset.translations || asset.translations.length === 0) {
            return (asset as any).name ?? '';
        }
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, asset, 'name');
    }

    @ResolveField()
    async languageCode(@Ctx() ctx: RequestContext, @Parent() asset: Asset): Promise<string> {
        // Handle assets without translations (legacy data)
        if (!asset.translations || asset.translations.length === 0) {
            return ctx.languageCode;
        }
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, asset, 'languageCode');
    }

    @ResolveField()
    translations(@Ctx() ctx: RequestContext, @Parent() asset: Asset): any[] {
        // Return empty array for assets without translations (legacy data)
        return asset.translations ?? [];
    }

    @ResolveField()
    async tags(@Ctx() ctx: RequestContext, @Parent() asset: Asset): Promise<Tag[]> {
        // Joined tags have not necessarily passed their own ownership filter.
        if (asset.tags) {
            const tags = await Promise.all(
                asset.tags.map(tag =>
                    this.requestContextCache.load<Tag | undefined>(
                        ctx,
                        `AssetEntityResolver.tags(${ctx.channelId})`,
                        tag.id,
                        async ids => {
                            const visible = new Map<string, Tag>();
                            for (let offset = 0; offset < ids.length; offset += 100) {
                                const result = await this.tagService.findAll(ctx, {
                                    filter: { id: { in: ids.slice(offset, offset + 100) } },
                                    take: 100,
                                });
                                result.items.forEach(item => visible.set(String(item.id), item));
                            }
                            return ids.map(id => visible.get(id));
                        },
                    ),
                ),
            );
            return tags.filter((tag): tag is Tag => tag !== undefined);
        }
        return this.tagService.getTagsForEntity(ctx, Asset, asset.id);
    }
}
