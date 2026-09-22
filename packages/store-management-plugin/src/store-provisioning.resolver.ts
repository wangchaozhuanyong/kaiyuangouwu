import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { manageStoreLifecyclePermission } from './constants';
import { StoreProvisioningService } from './store-provisioning.service';
import { ProvisionStoreInput } from './types';

@Resolver()
export class StoreProvisioningResolver {
    constructor(private readonly storeProvisioningService: StoreProvisioningService) {}

    @Query()
    @Allow(manageStoreLifecyclePermission.Permission, Permission.SuperAdmin)
    storeProvisioningTemplates(@Ctx() ctx: RequestContext) {
        return this.storeProvisioningService.findTemplates(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(manageStoreLifecyclePermission.Permission, Permission.SuperAdmin)
    provisionStore(@Ctx() ctx: RequestContext, @Args('input') input: ProvisionStoreInput) {
        return this.storeProvisioningService.provision(ctx, input);
    }
}
