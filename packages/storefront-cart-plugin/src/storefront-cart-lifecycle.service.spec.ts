import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { StorefrontCartLifecycleService } from './storefront-cart-lifecycle.service';

describe('StorefrontCartLifecycleService login handling', () => {
    function setup() {
        const handlers: Array<{ id: string; handler: (event: any) => unknown }> = [];
        const eventBus = {
            registerBlockingEventHandler: vi.fn((registration: any) => handlers.push(registration)),
        };
        const transactionContext = { apiType: 'shop', channelId: 'channel-1' };
        const connection = {
            withTransaction: vi.fn((_ctx, work) => work(transactionContext)),
        };
        const storefrontCartService = {
            mergeAfterLogin: vi.fn().mockResolvedValue(undefined),
        };
        const service = new StorefrontCartLifecycleService(
            eventBus as any,
            connection as any,
            {} as any,
            storefrontCartService as any,
        );

        service.onApplicationBootstrap();

        const loginHandler = handlers.find(handler => handler.id === 'storefront-cart-merge-on-login');
        if (!loginHandler) throw new Error('Login event handler was not registered');

        return { connection, loginHandler, storefrontCartService, transactionContext };
    }

    it('ignores administrator logins', async () => {
        const { connection, loginHandler, storefrontCartService } = setup();

        await loginHandler.handler({ ctx: { apiType: 'admin' }, user: { id: 'administrator-1' } });

        expect(connection.withTransaction).not.toHaveBeenCalled();
        expect(storefrontCartService.mergeAfterLogin).not.toHaveBeenCalled();
    });

    it('merges the customer cart after a shop login', async () => {
        const { connection, loginHandler, storefrontCartService, transactionContext } = setup();
        const shopContext = { apiType: 'shop', channelId: 'channel-1' };

        await loginHandler.handler({ ctx: shopContext, user: { id: 'customer-1' } });

        expect(connection.withTransaction).toHaveBeenCalledWith(shopContext, expect.any(Function));
        expect(storefrontCartService.mergeAfterLogin).toHaveBeenCalledWith(transactionContext, 'customer-1');
    });
});
