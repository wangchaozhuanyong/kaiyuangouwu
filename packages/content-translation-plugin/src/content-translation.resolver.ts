import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { ContentTranslationBackfillService } from './content-translation-backfill.service.js';
import { ContentTranslationRetryService } from './content-translation-retry.service.js';
import { ContentTranslationService } from './content-translation.service.js';
import { TranslationExecutionService } from './translation-execution.service.js';
import { ContentTranslationSegment } from './types.js';

@Resolver()
export class ContentTranslationAdminResolver {
    constructor(
        private readonly service: ContentTranslationService,
        private readonly nativeTranslations: ContentTranslationBackfillService,
        private readonly retry: ContentTranslationRetryService,
        private readonly execution: TranslationExecutionService,
    ) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    contentTranslationAudit(@Ctx() ctx: RequestContext, @Args() args: { channelId?: string | null }) {
        return this.service.audit(ctx, args.channelId === undefined ? ctx.channelId : args.channelId);
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
    @Mutation()
    @Allow(Permission.SuperAdmin)
    async retryCustomerContentTranslations(@Ctx() ctx: RequestContext, @Args() args: { ids: string[] }) {
        const result = await this.retry.requestRetry(ctx, args.ids);
        if (result.queued) await this.execution.reset();
        return result;
    }
}
