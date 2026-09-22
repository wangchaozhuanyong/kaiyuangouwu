import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import type { Response } from 'express';

import { DataConsentService, StorefrontAnalyticsConsentInput } from './data-consent.service';

@Resolver()
export class DataConsentShopResolver {
    constructor(private readonly consents: DataConsentService) {}

    @Query()
    @Allow(Permission.Authenticated)
    myDataConsentRecords(@Ctx() ctx: RequestContext) {
        return this.consents.myRecords(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Public)
    async recordStorefrontAnalyticsConsent(
        @Ctx() ctx: RequestContext,
        @Args('input') input: StorefrontAnalyticsConsentInput,
        @Context('res') res: Response,
    ) {
        const record = await this.consents.recordAnalyticsConsent(ctx, input);
        res.append('Set-Cookie', this.consents.analyticsCookie(ctx, input.granted));
        return record;
    }
}

@Resolver()
export class DataConsentAdminResolver {
    constructor(private readonly consents: DataConsentService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    dataConsentRecords(@Ctx() ctx: RequestContext) {
        return this.consents.listRecords(ctx);
    }
}
