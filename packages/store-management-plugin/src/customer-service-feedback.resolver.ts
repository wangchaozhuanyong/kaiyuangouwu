import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import {
    CustomerServiceFeedbackService,
    SubmitCustomerServiceFeedbackInput,
} from './customer-service-feedback.service';
import { CustomerServiceFeedback } from './entities/customer-service-feedback.entity';

@Resolver()
export class CustomerServiceFeedbackShopResolver {
    constructor(private readonly feedback: CustomerServiceFeedbackService) {}

    @Query()
    @Allow(Permission.Authenticated)
    myCustomerServiceFeedback(@Ctx() ctx: RequestContext, @Args('orderCode') orderCode?: string) {
        return this.feedback.myFeedback(ctx, orderCode);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    submitMyCustomerServiceFeedback(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SubmitCustomerServiceFeedbackInput,
    ) {
        return this.feedback.submit(ctx, input);
    }
}

@Resolver()
export class CustomerServiceFeedbackAdminResolver {
    constructor(private readonly feedback: CustomerServiceFeedbackService) {}

    @Query()
    @Allow(Permission.ReadCustomer)
    customerServiceFeedbacks(@Ctx() ctx: RequestContext, @Args('skip') skip = 0, @Args('take') take = 50) {
        return this.feedback.list(ctx, skip, take);
    }
}

@Resolver('CustomerServiceFeedback')
export class CustomerServiceFeedbackFieldsResolver {
    @ResolveField()
    tags(@Parent() record: CustomerServiceFeedback & { tags?: string[] }) {
        return record.tags ?? [];
    }
}
