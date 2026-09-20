import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';
import type {
    CreateCustomerFollowUpInput,
    CustomerFollowUpListOptions,
    CustomerOperationsProfileListOptions,
    UpdateCustomerFollowUpInput,
} from './customer-operations.types';

import { CustomerOperationsService } from './customer-operations.service';
import { CustomerFollowUp } from './entities/customer-follow-up.entity';
import { CustomerOperationsProfile } from './entities/customer-operations-profile.entity';

@Resolver()
export class CustomerOperationsAdminResolver {
    constructor(private readonly customerOperations: CustomerOperationsService) {}

    @Query()
    @Allow(Permission.ReadCustomer)
    customerOperationsProfile(@Ctx() ctx: RequestContext, @Args('customerId') customerId: ID) {
        return this.customerOperations.findProfile(ctx, customerId);
    }

    @Query()
    @Allow(Permission.ReadCustomer)
    customerOperationsProfiles(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options?: CustomerOperationsProfileListOptions,
    ) {
        return this.customerOperations.listProfiles(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadCustomer)
    customerFollowUps(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options?: CustomerFollowUpListOptions,
    ) {
        return this.customerOperations.listFollowUps(ctx, options);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    refreshCustomerOperationsProfile(@Ctx() ctx: RequestContext, @Args('customerId') customerId: ID) {
        return this.customerOperations.evaluateCustomer(ctx, customerId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    createCustomerFollowUp(@Ctx() ctx: RequestContext, @Args('input') input: CreateCustomerFollowUpInput) {
        return this.customerOperations.createFollowUp(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    updateCustomerFollowUp(@Ctx() ctx: RequestContext, @Args('input') input: UpdateCustomerFollowUpInput) {
        return this.customerOperations.updateFollowUp(ctx, input);
    }
}

@Resolver('CustomerOperationsProfile')
export class CustomerOperationsProfileResolver {
    constructor(private readonly customerOperations: CustomerOperationsService) {}

    @ResolveField()
    currencyMetrics(@Parent() profile: CustomerOperationsProfile) {
        return this.customerOperations.currencyMetrics(profile);
    }

    @ResolveField()
    reasons(@Parent() profile: CustomerOperationsProfile) {
        return this.customerOperations.reasons(profile);
    }
}

@Resolver('CustomerFollowUp')
export class CustomerFollowUpResolver {
    @ResolveField()
    overdue(@Parent() followUp: CustomerFollowUp) {
        return followUp.status === 'OPEN' && followUp.dueAt.getTime() <= Date.now();
    }
}
