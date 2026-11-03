import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import type { Request, Response } from 'express';

import { EnvironmentMonitorService } from './environment-monitor.service';

export { environmentMonitorSchema } from './environment-monitor.schema';

@Resolver()
export class EnvironmentMonitorResolver {
    constructor(private readonly monitor: EnvironmentMonitorService) {}

    @Query()
    @Allow(Permission.Public)
    environmentNetworkReport(
        @Ctx() ctx: RequestContext,
        @Context('req') req: Request,
        @Context('res') res: Response,
        @Args('observedIpv4', { nullable: true }) observedIpv4?: string,
        @Args('observedIpv6', { nullable: true }) observedIpv6?: string,
    ) {
        res.setHeader('Cache-Control', 'no-store');
        return this.monitor.lookup(ctx, req, observedIpv4, observedIpv6);
    }
}
