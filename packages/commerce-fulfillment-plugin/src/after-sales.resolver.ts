import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { AfterSalesService } from './after-sales.service';
import {
    AfterSalesRequestListOptions,
    ConfirmAfterSalesReplacementInput,
    CreateAfterSalesRequestInput,
    InspectAfterSalesReturnInput,
    ReceiveAfterSalesReturnInput,
    SubmitAfterSalesReturnShipmentInput,
    TransitionAfterSalesRequestInput,
    UpdateAfterSalesReplacementInput,
} from './types';

@Resolver()
export class AfterSalesShopResolver {
    constructor(private readonly afterSalesService: AfterSalesService) {}

    @Query()
    @Allow(Permission.Authenticated)
    myAfterSalesRequests(@Ctx() ctx: RequestContext) {
        return this.afterSalesService.findForCustomer(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myAfterSalesRequest(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.afterSalesService.findOneForCustomer(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    createAfterSalesRequest(@Ctx() ctx: RequestContext, @Args('input') input: CreateAfterSalesRequestInput) {
        return this.afterSalesService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    cancelMyAfterSalesRequest(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.afterSalesService.cancelForCustomer(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    submitMyAfterSalesReturnShipment(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SubmitAfterSalesReturnShipmentInput,
    ) {
        return this.afterSalesService.submitReturnShipmentForCustomer(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    confirmMyAfterSalesReplacement(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ConfirmAfterSalesReplacementInput,
    ) {
        return this.afterSalesService.confirmReplacementForCustomer(ctx, input);
    }
}

@Resolver()
export class AfterSalesAdminResolver {
    constructor(private readonly afterSalesService: AfterSalesService) {}

    @Query()
    @Allow(Permission.ReadOrder)
    afterSalesRequests(@Ctx() ctx: RequestContext, @Args('options') options?: AfterSalesRequestListOptions) {
        return this.afterSalesService.findForAdmin(ctx, options);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    transitionAfterSalesRequest(
        @Ctx() ctx: RequestContext,
        @Args('input') input: TransitionAfterSalesRequestInput,
    ) {
        return this.afterSalesService.transitionForAdmin(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    receiveAfterSalesReturn(@Ctx() ctx: RequestContext, @Args('input') input: ReceiveAfterSalesReturnInput) {
        return this.afterSalesService.receiveReturnForAdmin(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    inspectAfterSalesReturn(@Ctx() ctx: RequestContext, @Args('input') input: InspectAfterSalesReturnInput) {
        return this.afterSalesService.inspectReturnForAdmin(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    updateAfterSalesReplacement(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateAfterSalesReplacementInput,
    ) {
        return this.afterSalesService.updateReplacementForAdmin(ctx, input);
    }
}
