import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { ContentTranslationService } from './content-translation.service.js';
import { NativeContentTranslationService } from './native-content-translation.service.js';
import { ContentTranslationSegment } from './types.js';

@Resolver()
export class ContentTranslationAdminResolver {
    constructor(
        private readonly service: ContentTranslationService,
        private readonly nativeTranslations: NativeContentTranslationService,
    ) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    contentTranslationAudit(@Ctx() ctx: RequestContext, @Args() args: { channelId?: string | null }) {
        return this.service.audit(ctx, args.channelId);
    }

    @Query()
    @Allow(Permission.Authenticated)
    contentTranslationStaleCount(@Ctx() ctx: RequestContext) {
        return this.service.countStale(ctx);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async translateCustomerContent(@Args() args: { segments: ContentTranslationSegment[] }) {
        if (!this.service.isConfigured()) {
            return {
                configured: false,
                provider: this.service.providerName(),
                translations: [],
            };
        }
        const result = await this.service.translate({ segments: args.segments });
        return { configured: true, ...result };
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    backfillCustomerContentTranslations(
        @Ctx() ctx: RequestContext,
        @Args() args: { entityType?: string | null; limit?: number | null; offset?: number | null },
    ) {
        return this.nativeTranslations.backfill(ctx, args.entityType, args.limit ?? 100, args.offset ?? 0);
    }
}
