import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { StoreProvisioningService } from './store-provisioning.service';
import { ProvisionStoreInput } from './types';

@Resolver()
export class StoreProvisioningResolver {
    constructor(private readonly storeProvisioningService: StoreProvisioningService) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    provisionStore(@Ctx() ctx: RequestContext, @Args('input') input: ProvisionStoreInput) {
        return this.storeProvisioningService.provision(ctx, input);
    }
}
