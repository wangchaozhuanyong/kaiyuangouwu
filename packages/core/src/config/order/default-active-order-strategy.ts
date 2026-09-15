import { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import { Injector } from '../../common/injector';

import { ActiveOrderStrategy } from './active-order-strategy';

/**
 * @description
 * The default {@link ActiveOrderStrategy}, which uses the current {@link Session} to determine
 * the active Order, and requires no additional input in the Shop API since it is based on the
 * session which is part of the RequestContext.
 *
 * @since 1.9.0
 * @docsCategory orders
 */
export class DefaultActiveOrderStrategy implements ActiveOrderStrategy {
    private orderService: import('../../service/services/order.service').OrderService;

    name: 'default-active-order-strategy';

    async init(injector: Injector) {
        // Lazy import these dependencies to avoid a circular dependency issue in NestJS.
        const { OrderService } = await import('../../service/services/order.service.js');
        this.orderService = injector.get(OrderService);
    }

    createActiveOrder(ctx: RequestContext) {
        return this.orderService.create(ctx, ctx.activeUserId);
    }

    async determineActiveOrder(ctx: RequestContext) {
        if (!ctx.session) {
            throw new InternalServerError('error.no-active-session');
        }
        let order = await this.orderService.getActiveOrderFromSession(ctx);
        if (!order) {
            if (ctx.activeUserId) {
                order = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
            }
        }
        return order || undefined;
    }
}
