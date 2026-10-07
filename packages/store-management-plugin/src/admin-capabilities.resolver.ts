import { Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, RequestContext } from '@vendure/core';

import { AdminCapabilitiesService } from './admin-capabilities.service';

@Resolver()
export class AdminCapabilitiesResolver {
    constructor(private readonly capabilities: AdminCapabilitiesService) {}

    @Query()
    @Allow(Permission.Authenticated)
    currentAdminCapabilities(@Ctx() ctx: RequestContext) {
        return this.capabilities.current(ctx);
    }
}
