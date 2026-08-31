import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import {
    CustomerDeliveryEmailService,
    SaveCustomerDeliveryEmailInput,
    SetActiveOrderDeliveryEmailInput,
} from './customer-delivery-email.service';

@Resolver()
export class CustomerDeliveryEmailShopResolver {
    constructor(private readonly service: CustomerDeliveryEmailService) {}

    @Query()
    @Allow(Permission.Authenticated)
    myDeliveryEmails(@Ctx() ctx: RequestContext) {
        return this.service.listMine(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Public)
    setActiveOrderDeliveryEmail(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SetActiveOrderDeliveryEmailInput,
    ) {
        return this.service.setActiveOrderEmail(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    saveMyDeliveryEmail(@Ctx() ctx: RequestContext, @Args('input') input: SaveCustomerDeliveryEmailInput) {
        return this.service.saveMine(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    setMyDefaultDeliveryEmail(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.service.setDefaultMine(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    deleteMyDeliveryEmail(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.service.deleteMine(ctx, id);
    }
}
