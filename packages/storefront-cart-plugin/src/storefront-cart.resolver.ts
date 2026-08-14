import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ID,
    isGraphQlErrorResult,
    Permission,
    RequestContext,
    Transaction,
    TransactionalConnection,
} from '@vendure/core';

import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import {
    StorefrontCartService,
    StorefrontCheckoutSession,
    StorefrontCheckoutResult,
} from './storefront-cart.service';

interface AddItemArgs {
    input: { productVariantId: ID; quantity: number };
    expectedRevision: number;
}

interface RevisionArgs {
    expectedRevision: number;
}

@Resolver()
export class StorefrontCartShopResolver {
    constructor(
        private readonly storefrontCartService: StorefrontCartService,
        private readonly connection: TransactionalConnection,
    ) {}

    @Transaction()
    @Query()
    @Allow(Permission.Owner)
    async storefrontCart(@Ctx() ctx: RequestContext) {
        const cart = await this.storefrontCartService.getCart(ctx);
        await this.storefrontCartService.syncActiveOrderSession(ctx, cart);
        return cart;
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    addStorefrontCartItem(@Ctx() ctx: RequestContext, @Args() args: AddItemArgs) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.addItem(ctx, args.input, args.expectedRevision),
        );
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    setStorefrontCartLineQuantity(
        @Ctx() ctx: RequestContext,
        @Args() args: RevisionArgs & { lineId: ID; quantity: number },
    ) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.setLineQuantity(
                ctx,
                args.lineId,
                args.quantity,
                args.expectedRevision,
            ),
        );
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    removeStorefrontCartLines(
        @Ctx() ctx: RequestContext,
        @Args() args: RevisionArgs & { lineIds: ID[] },
    ) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.removeLines(ctx, args.lineIds, args.expectedRevision),
        );
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    setStorefrontCartLinesSelected(
        @Ctx() ctx: RequestContext,
        @Args() args: RevisionArgs & { lineIds: ID[]; selected: boolean },
    ) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.setLinesSelected(
                ctx,
                args.lineIds,
                args.selected,
                args.expectedRevision,
            ),
        );
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    setAllStorefrontCartLinesSelected(
        @Ctx() ctx: RequestContext,
        @Args() args: RevisionArgs & { selected: boolean },
    ) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.setAllLinesSelected(
                ctx,
                args.selected,
                args.expectedRevision,
            ),
        );
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    beginStorefrontCheckout(@Ctx() ctx: RequestContext, @Args() args: RevisionArgs) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.beginCheckout(ctx, args.expectedRevision),
        );
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    prepareStorefrontCartPayment(@Ctx() ctx: RequestContext, @Args() args: RevisionArgs) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.preparePayment(ctx, args.expectedRevision),
        );
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.Owner)
    reopenStorefrontCart(@Ctx() ctx: RequestContext, @Args() args: RevisionArgs) {
        return this.runMutation(ctx, () =>
            this.storefrontCartService.reopenCart(ctx, args.expectedRevision),
        );
    }

    private async runMutation<T extends Awaited<ReturnType<StorefrontCartService['addItem']>> | StorefrontCheckoutResult>(
        ctx: RequestContext,
        work: () => Promise<T>,
    ): Promise<T> {
        await this.connection.startTransaction(ctx);
        const result = await work();
        if (isGraphQlErrorResult(result)) {
            await this.connection.rollBackTransaction(ctx);
            return result;
        }
        const cart =
            result instanceof StorefrontCart
                ? result
                : (result as StorefrontCheckoutSession).cart;
        await this.storefrontCartService.syncActiveOrderSession(ctx, cart);
        await this.connection.commitOpenTransaction(ctx);
        return result;
    }
}

@Resolver('StorefrontCart')
export class StorefrontCartEntityResolver {
    @ResolveField()
    totalQuantity(@Parent() cart: StorefrontCart): number {
        return cart.lines.reduce((total, line) => total + line.quantity, 0);
    }

    @ResolveField()
    selectedLineCount(@Parent() cart: StorefrontCart): number {
        return cart.lines.filter(line => line.selected).length;
    }

    @ResolveField()
    selectedQuantity(@Parent() cart: StorefrontCart): number {
        return cart.lines.reduce((total, line) => total + (line.selected ? line.quantity : 0), 0);
    }

    @ResolveField()
    selectionState(@Parent() cart: StorefrontCart): 'NONE' | 'PARTIAL' | 'ALL' {
        const selectedCount = cart.lines.filter(line => line.selected).length;
        if (selectedCount === 0) {
            return 'NONE';
        }
        return selectedCount === cart.lines.length ? 'ALL' : 'PARTIAL';
    }

    @ResolveField()
    lines(@Parent() cart: StorefrontCart): StorefrontCartLine[] {
        return cart.lines;
    }
}

@Resolver('StorefrontCartLine')
export class StorefrontCartLineEntityResolver {
    @ResolveField()
    available(@Parent() line: StorefrontCartLine): boolean {
        return !!line.productVariant?.enabled && !!line.productVariant.product?.enabled;
    }

    @ResolveField()
    productVariant(@Parent() line: StorefrontCartLine) {
        return line.productVariant ?? null;
    }
}
