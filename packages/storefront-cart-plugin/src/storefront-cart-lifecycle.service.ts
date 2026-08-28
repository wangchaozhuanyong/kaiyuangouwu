import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
    EventBus,
    Logger,
    LoginEvent,
    OrderPlacedEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull, Not } from 'typeorm';

import { StorefrontCartCheckout } from './entities/storefront-cart-checkout.entity';
import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import { StorefrontCartService } from './storefront-cart.service';

const loggerCtx = 'StorefrontCartLifecycleService';

@Injectable()
export class StorefrontCartLifecycleService implements OnApplicationBootstrap {
    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly storefrontCartService: StorefrontCartService,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus.registerBlockingEventHandler({
            event: OrderPlacedEvent,
            id: 'storefront-cart-complete-checkout',
            handler: event => this.completeCheckout(event),
        });
        this.eventBus.registerBlockingEventHandler({
            event: LoginEvent,
            id: 'storefront-cart-merge-on-login',
            handler: event => this.mergeCartAfterLogin(event),
        });
    }

    private async mergeCartAfterLogin(event: LoginEvent): Promise<void> {
        if (event.ctx.apiType !== 'shop') {
            return;
        }
        try {
            await this.connection.withTransaction(event.ctx, txCtx =>
                this.storefrontCartService.mergeAfterLogin(txCtx, event.user.id),
            );
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            Logger.warn(
                `Cart merge after login failed (${reason}). Login will continue and the cart will be retried on the next interaction.`,
                loggerCtx,
            );
        }
    }

    private async completeCheckout(event: OrderPlacedEvent): Promise<void> {
        await this.completeCheckoutForOrder(event.ctx, event.order.id);
    }

    async completeCheckoutForOrder(ctx: RequestContext, orderId: string | number): Promise<void> {
        const checkoutRepository = this.connection.getRepository(ctx, StorefrontCartCheckout);
        const checkout = await checkoutRepository.findOne({
            where: { orderId, state: 'PREPARED' },
            relations: ['lines', 'cart', 'cart.lines'],
        });
        if (!checkout || checkout.cart.channelId.toString() !== ctx.channelId.toString()) {
            return;
        }
        const claimed = await checkoutRepository.update(
            { id: checkout.id, state: 'PREPARED' },
            { state: 'PLACED', completedAt: new Date() },
        );
        if (claimed.affected !== 1) {
            return;
        }

        const lineRepository = this.connection.getRepository(ctx, StorefrontCartLine);
        for (const snapshotLine of checkout.lines) {
            const cartLine = checkout.cart.lines.find(
                line =>
                    snapshotLine.cartLineId != null &&
                    line.id.toString() === snapshotLine.cartLineId.toString(),
            );
            if (!cartLine) {
                continue;
            }
            const remainingQuantity = cartLine.quantity - snapshotLine.quantity;
            if (remainingQuantity <= 0) {
                await lineRepository.delete(cartLine.id);
            } else {
                await lineRepository.update(cartLine.id, {
                    quantity: remainingQuantity,
                    orderLineId: null,
                });
            }
        }
        await lineRepository.update({ cartId: checkout.cartId }, { orderLineId: null });
        await this.connection.getRepository(ctx, StorefrontCart).update(checkout.cartId, {
            state: 'OPEN',
            checkoutOrderId: null,
            projectedRevision: null,
            revision: checkout.cart.revision + 1,
            lastActivityAt: new Date(),
        });
    }

    async reconcilePlacedCheckouts(): Promise<number> {
        const checkouts = await this.connection.rawConnection.getRepository(StorefrontCartCheckout).find({
            where: { state: 'PREPARED', order: { active: false, orderPlacedAt: Not(IsNull()) } },
            relations: ['order', 'cart', 'cart.channel'],
            take: 100,
        });
        for (const checkout of checkouts) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: checkout.cart.channel,
            });
            await this.connection.withTransaction(ctx, txCtx =>
                this.completeCheckoutForOrder(txCtx, checkout.orderId),
            );
        }
        return checkouts.length;
    }
}
