import { Args, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    API_KEY_AUTH_STRATEGY_NAME,
    Ctx,
    ForbiddenError,
    Permission,
    RequestContext,
} from '@vendure/core';
import { isIP } from 'node:net';

import { ID_BUSINESS_CLIENT_IP_HEADER, manageIcloudRelayPermission } from '../constants';
import { IcloudPublicQueryService } from '../services/icloud-public-query.service';

@Resolver()
export class IcloudPublicResolver {
    constructor(private readonly publicQueryService: IcloudPublicQueryService) {}

    @Query()
    @Allow(Permission.Public)
    async icloudQueryMails(@Ctx() ctx: RequestContext, @Args('queryCode') queryCode: string) {
        const req = ctx.req;
        const forwardedClientIp = req?.headers[ID_BUSINESS_CLIENT_IP_HEADER];
        const authenticatedClientIp =
            ctx.session?.authenticationStrategy === API_KEY_AUTH_STRATEGY_NAME &&
            ctx.userHasPermissions([manageIcloudRelayPermission.Read]) &&
            typeof forwardedClientIp === 'string' &&
            isIP(forwardedClientIp.trim())
                ? forwardedClientIp.trim()
                : undefined;
        // Express resolves req.ip using configured trusted proxies. The dedicated ID Business API key
        // may carry the original browser address across the separate public HTTPS proxy chain.
        const clientIp = authenticatedClientIp || req?.ip || req?.socket?.remoteAddress;
        if (!clientIp) throw new ForbiddenError();
        return this.publicQueryService.queryByCode(
            ctx,
            queryCode,
            clientIp,
            req?.headers['user-agent'] || '',
        );
    }
}
