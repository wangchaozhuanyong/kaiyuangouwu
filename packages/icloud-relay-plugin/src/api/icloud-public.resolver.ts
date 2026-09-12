import { Args, Query, Resolver } from '@nestjs/graphql';
import { Ctx, RequestContext } from '@vendure/core';

import { IcloudPublicQueryService } from '../services/icloud-public-query.service';

@Resolver()
export class IcloudPublicResolver {
    constructor(private readonly publicQueryService: IcloudPublicQueryService) {}

    @Query()
    async icloudQueryMails(@Ctx() ctx: RequestContext, @Args('queryCode') queryCode: string) {
        // Extract client IP from request context
        const req = (ctx as any).req;
        let clientIp = '0.0.0.0';
        let userAgent = '';
        if (req) {
            clientIp =
                req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
                req.headers?.['x-real-ip'] ||
                req.socket?.remoteAddress ||
                '0.0.0.0';
            userAgent = req.headers?.['user-agent'] || '';
        }

        return this.publicQueryService.queryByCode(ctx, queryCode, clientIp, userAgent);
    }
}
