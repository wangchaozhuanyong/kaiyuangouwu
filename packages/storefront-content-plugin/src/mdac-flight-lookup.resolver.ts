import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ForbiddenError, Permission, RequestContext } from '@vendure/core';

import { MdacFlightLookupResult, MdacFlightLookupService } from './mdac-flight-lookup.service';
import { StorefrontContentService } from './storefront-content.service';

@Resolver()
export class MdacFlightLookupShopResolver {
    constructor(
        private readonly content: StorefrontContentService,
        private readonly flights: MdacFlightLookupService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    async mdacFlightLookup(
        @Ctx() ctx: RequestContext,
        @Args('arrivalDate') arrivalDate: string,
        @Args('arrivalAirport') arrivalAirport: string,
        @Args('flightNumber') flightNumber: string,
    ): Promise<MdacFlightLookupResult> {
        if (!(await this.content.canLookupMdacFlights(ctx))) throw new ForbiddenError();
        // Accept only Express's already resolved IP under the existing trust-proxy policy.
        const ip = ctx.req?.ip || ctx.req?.socket?.remoteAddress || 'unknown';
        return this.flights.lookup({ arrivalDate, arrivalAirport, flightNumber }, ip);
    }
}
