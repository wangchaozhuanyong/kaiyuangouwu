import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ForbiddenError, Permission, RequestContext } from '@vendure/core';

import { IcloudPublicQueryService } from '../services/icloud-public-query.service';

@Resolver()
export class IcloudPublicResolver {
    constructor(private readonly publicQueryService: IcloudPublicQueryService) {}

    @Query()
    @Allow(Permission.Public)
    async icloudQueryMails(@Ctx() ctx: RequestContext, @Args('queryCode') queryCode: string) {
        const req = ctx.req;
        // Express resolves req.ip using the configured trusted proxies.
        const clientIp = req?.ip || req?.socket?.remoteAddress;
        if (!clientIp) throw new ForbiddenError();
        return this.publicQueryService.queryByCode(
            ctx,
            queryCode,
            clientIp,
            req?.headers['user-agent'] || '',
        );
    }
}
